/** One-time maintenance. Default is read-only; --apply requires a reviewed plan.
 * Never imports a seed or boots AppModule. Never overwrites an R2 object.
 * Run the compiled script with --plan=<absolute JSON path> [--apply].
 */
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { PrismaClient } from "@smartify/database";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { defaultObjectKey, assertLooksLikeRealPdf } from "../interactive-lesson/unit-grounding/storage/curriculum-source-upload.service";

type Item = {
  verified: boolean; subjectId: string | null; expectedSourceFile: string | null;
  curriculumCode: string; gradeNameEn: string; gradeLevel: number; subjectNameEn: string;
  manifestSourceFile: string; localPdf: string | null; sha256: string | null; r2Key: string;
};
type Plan = {
  target: { databaseHost: string; databaseName: string; bucket: string; endpoint: string } | null;
  items: Item[];
};
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const isExtra = (value: string | null) => !!value && value.split(/[\\/]/).some(p => p.toLowerCase() === "extras");

async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => a !== "--apply" && !a.startsWith("--plan="))) throw new Error("Unknown argument");
  const planPath = args.find(a => a.startsWith("--plan="))?.slice(7);
  if (!planPath) throw new Error("A reviewed --plan path is required");
  const plan: Plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  const apply = args.includes("--apply");
  const env = process.env;
  if (!plan.target || !Array.isArray(plan.items) || !plan.items.length) throw new Error("Missing target or items");
  const dbUrl = new URL(env.DATABASE_URL ?? "");
  if (dbUrl.host !== plan.target.databaseHost || decodeURIComponent(dbUrl.pathname.slice(1)) !== plan.target.databaseName ||
      env.CURRICULUM_STORAGE_PROVIDER !== "s3" || env.CURRICULUM_S3_BUCKET !== plan.target.bucket ||
      env.CURRICULUM_S3_ENDPOINT !== plan.target.endpoint) throw new Error("Runtime target does not match reviewed plan");
  if (!env.CURRICULUM_S3_ACCESS_KEY_ID || !env.CURRICULUM_S3_SECRET_ACCESS_KEY) throw new Error("Explicit storage credentials required");
  const selected = plan.items.filter(i => i.verified);
  if (!selected.length) throw new Error("No verified items in plan");
  if (new Set(selected.map(i => i.subjectId)).size !== selected.length || new Set(selected.map(i => i.r2Key)).size !== selected.length) throw new Error("Duplicate subjects or object keys");
  // Validate all local inputs before any network writes.
  const bytes = selected.map(i => {
    if (!i.subjectId || !i.localPdf || !path.isAbsolute(i.localPdf) || !i.sha256 ||
        !["EG_NATIONAL", "BRITISH_INTL"].includes(i.curriculumCode) ||
        isExtra(i.localPdf) || isExtra(i.r2Key) || isExtra(i.expectedSourceFile) ||
        i.r2Key !== defaultObjectKey(i.curriculumCode, i.gradeLevel, i.subjectNameEn, i.manifestSourceFile)) throw new Error("Invalid reviewed item");
    assertLooksLikeRealPdf(i.localPdf);
    const data = fs.readFileSync(i.localPdf);
    if (hash(data) !== i.sha256) throw new Error("Local PDF changed since review");
    return data;
  });
  const prisma = new PrismaClient();
  const s3 = new S3Client({ region: env.CURRICULUM_S3_REGION || "auto", endpoint: plan.target.endpoint,
    forcePathStyle: env.CURRICULUM_S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: env.CURRICULUM_S3_ACCESS_KEY_ID, secretAccessKey: env.CURRICULUM_S3_SECRET_ACCESS_KEY } });
  const bucket = plan.target.bucket;
  async function remoteHash(key: string): Promise<string | null> {
    try {
      const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!result.Body) throw new Error("Empty object response");
      const digest = createHash("sha256");
      for await (const chunk of result.Body as AsyncIterable<Uint8Array>) digest.update(chunk);
      return digest.digest("hex");
    } catch (error) {
      // A missing bucket, permissions problem, or network error is NOT absence.
      if ((error as { name?: string }).name === "NoSuchKey") return null;
      throw error;
    }
  }
  try {
    for (let n = 0; n < selected.length; n++) {
      const item = selected[n];
      const subject = await prisma.subject.findUniqueOrThrow({ where: { id: item.subjectId! }, include: { grade: { include: { curriculum: true } } } });
      if (subject.nameEn !== item.subjectNameEn || subject.grade.nameEn !== item.gradeNameEn || subject.grade.level !== item.gradeLevel ||
          subject.grade.curriculum.code !== item.curriculumCode || isExtra(subject.sourceFile) ||
          (subject.sourceFile !== item.expectedSourceFile && subject.sourceFile !== item.r2Key)) throw new Error("Subject identity or mapping changed; review again");
      const existing = await remoteHash(item.r2Key);
      if (existing !== null && existing !== item.sha256) throw new Error("Existing R2 object differs; refusing overwrite or remapping");
      console.log(JSON.stringify({ subjectId: subject.id, oldSourceFile: subject.sourceFile, newSourceFile: item.r2Key,
        object: existing === null ? "ABSENT" : "BYTE_IDENTICAL", mode: apply ? "APPLY" : "DRY_RUN" }));
      if (!apply) continue;
      if (existing === null) {
        // Conditional create prevents overwriting an object uploaded after our read.
        try {
          await s3.send(new PutObjectCommand({ Bucket: bucket, Key: item.r2Key, Body: bytes[n], ContentType: "application/pdf", IfNoneMatch: "*" }));
        } catch (error) {
          if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw error;
        }
      }
      if (await remoteHash(item.r2Key) !== item.sha256) throw new Error("Remote byte verification failed; database unchanged for this item");
      // One atomic compare-and-set per item; only sourceFile can change.
      if (subject.sourceFile !== item.r2Key) {
        const result = await prisma.subject.updateMany({ where: { id: subject.id, sourceFile: subject.sourceFile,
          nameEn: item.subjectNameEn, gradeId: subject.gradeId }, data: { sourceFile: item.r2Key } });
        if (result.count !== 1) throw new Error("Concurrent mapping change; database update skipped");
      }
    }
  } finally {
    await prisma.$disconnect();
    s3.destroy();
  }
}

main().catch(() => {
  // SDK/Prisma errors may include connection details. Never print them here.
  console.error("Textbook repair stopped. Review the plan, target, mapping and object checks. No further items processed.");
  process.exitCode = 1;
});
