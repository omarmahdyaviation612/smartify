import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { CurriculumSourceStorageFactory } from "./curriculum-source-storage.factory";

// Mirrors S3CurriculumSourceStorage's own limit — checked here too so a
// clearly-oversized file is rejected before any network call.
export const MAX_SOURCE_FILE_SIZE_BYTES = 200 * 1024 * 1024;
const PDF_MAGIC_BYTES = Buffer.from("%PDF-");

/** Object keys are always server-generated or, if explicitly overridden (CLI only), validated to rule out path traversal / absolute paths — this key is later used verbatim as an S3 object Key. */
export function assertSafeObjectKey(key: string): void {
  if (path.isAbsolute(key) || key.includes("..") || key.startsWith("/") || key.includes("\\")) {
    throw new Error(`Unsafe --key value "${key}" — must be a relative, forward-slash path with no ".." segments.`);
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** `filename` only needs to be the meaningful name to derive the key from — a full local path (CLI) or just an uploaded file's original name (HTTP) both work identically, since only its basename (extension stripped) is used. */
export function defaultObjectKey(curriculumCode: string, gradeLevel: number, subjectNameEn: string, filename: string): string {
  const base = slugify(path.basename(filename, path.extname(filename))) + ".pdf";
  return [slugify(curriculumCode), `grade-${gradeLevel}`, slugify(subjectNameEn), base].join("/");
}

/**
 * English Extra Book / Story support V1 (2026-09-20) — the deterministic
 * key convention for an extra/story book, under an "extras/" prefix so it
 * can never collide with (or be confused for) a Subject's own main
 * textbook object. Pure function of trusted server-side Subject data
 * (curriculum/grade/subject name, all read from the DB, never the client)
 * plus the admin-chosen `bookLabel` — this determinism is what lets
 * confirmExtraBookStructure() independently re-derive and verify the
 * exact same key rather than trusting a client-supplied R2 key.
 */
export function defaultExtraBookObjectKey(curriculumCode: string, gradeLevel: number, subjectNameEn: string, bookLabel: string): string {
  const slug = slugify(bookLabel);
  if (!slug) throw new BadRequestException("Enter a valid book name.");
  return [slugify(curriculumCode), `grade-${gradeLevel}`, slugify(subjectNameEn), "extras", `${slug}.pdf`].join("/");
}

export function assertLooksLikeRealPdf(localPath: string): void {
  if (!fs.existsSync(localPath)) {
    throw new Error(`File not found: ${localPath}`);
  }
  const stats = fs.statSync(localPath);
  if (stats.size > MAX_SOURCE_FILE_SIZE_BYTES) {
    throw new Error(`File is ${stats.size} bytes — exceeds the ${MAX_SOURCE_FILE_SIZE_BYTES}-byte limit.`);
  }
  const fd = fs.openSync(localPath, "r");
  try {
    const header = Buffer.alloc(PDF_MAGIC_BYTES.length);
    fs.readSync(fd, header, 0, header.length, 0);
    if (!header.equals(PDF_MAGIC_BYTES)) {
      throw new Error(`"${localPath}" does not look like a real PDF (missing "%PDF-" signature) — refusing to upload.`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

export interface CurriculumSourceUploadResult {
  subjectId: string;
  subjectNameEn: string;
  sourceFile: string;
}

export interface ExtraBookUploadResult {
  subjectId: string;
  bookLabel: string;
  objectKey: string;
}

type SubjectWithUnits = {
  id: string;
  nameEn: string;
  sourceFile: string | null;
  grade: { level: number; curriculum: { code: string } };
  units: Array<{ id: string; nameEn: string; groundingNotesJson: unknown }>;
};

/**
 * The ONE place a real textbook PDF is ever uploaded to curriculum source
 * storage and recorded on Subject.sourceFile (2026-09-20) — extracted from
 * the original apps/backend/src/scripts/upload-curriculum-source.ts CLI
 * script so the CLI and the Admin HTTP upload endpoint share the exact
 * same logic, never two implementations. Uploading is INERT by design: it
 * never triggers Unit grounding, Topic/Question generation, or any OpenAI
 * call — those stay fully lazy (see UnitGroundingService.ensureUnitGrounded)
 * — it only makes the source available for whenever that lazy trigger
 * eventually needs it.
 */
@Injectable()
export class CurriculumSourceUploadService {
  private readonly logger = new Logger(CurriculumSourceUploadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageFactory: CurriculumSourceStorageFactory,
  ) {}

  /**
   * CLI-facing (`pnpm curriculum:upload`) — preserves the exact pre-
   * refactor behavior, including `--replace` and the grounded-Unit
   * warning. Never exposed through Admin HTTP — see uploadFirstTime().
   */
  async upload(args: { subjectId: string; pdfPath: string; key?: string; replace: boolean }): Promise<CurriculumSourceUploadResult> {
    assertLooksLikeRealPdf(args.pdfPath);
    if (args.key) assertSafeObjectKey(args.key);

    const subject = await this.findSubjectWithUnits(args.subjectId);

    if (subject.sourceFile && !args.replace) {
      throw new Error(
        `Subject ${args.subjectId} ("${subject.nameEn}") already has sourceFile="${subject.sourceFile}". Pass --replace to overwrite it deliberately.`,
      );
    }
    if (subject.sourceFile && args.replace) {
      this.warnReplacingGroundedUnits(subject);
    }

    const objectKey = args.key ?? defaultObjectKey(subject.grade.curriculum.code, subject.grade.level, subject.nameEn, args.pdfPath);
    return this.storeAndUpdateSubject(subject, args.pdfPath, objectKey);
  }

  /**
   * Admin/HTTP-facing, Step 1 (2026-09-20) — first-time upload ONLY.
   * Deliberately has no `replace` parameter at all: an existing
   * Subject.sourceFile is an unconditional refusal with a generic, safe
   * message. Textbook replacement is a separate, not-yet-built feature
   * (Step 2) and must never be reachable through this path until then —
   * the CLI's own `upload()` above keeps `--replace` for operator/
   * backward-compatibility use only, never surfaced here.
   */
  async uploadFirstTime(args: { subjectId: string; pdfPath: string; originalFilename: string }): Promise<CurriculumSourceUploadResult> {
    assertLooksLikeRealPdf(args.pdfPath);

    const subject = await this.findSubjectWithUnits(args.subjectId);
    if (subject.sourceFile) {
      throw new BadRequestException("This subject already has a textbook. Textbook replacement is not enabled yet.");
    }

    const objectKey = defaultObjectKey(subject.grade.curriculum.code, subject.grade.level, subject.nameEn, args.originalFilename);
    return this.storeAndUpdateSubject(subject, args.pdfPath, objectKey);
  }

  /**
   * Buffer-to-tempfile adapter for HTTP uploads — the storage interface
   * and the PDF-signature check both operate on a real filesystem path
   * (mirroring S3CurriculumSourceStorage.fetchToTempFile's own pattern),
   * while a multer-buffered HTTP upload only ever provides an in-memory
   * Buffer. The temp file is named generically ("upload.pdf" inside a
   * freshly created unique temp directory) — never derived from the
   * caller-supplied filename — and is always removed in `finally`,
   * regardless of which step (validation, storage upload, or the DB
   * update) succeeds or throws.
   */
  async uploadFromBuffer(args: { subjectId: string; buffer: Buffer; originalFilename: string }): Promise<CurriculumSourceUploadResult> {
    const tempDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "smartify-textbook-upload-"));
    const tempPath = path.join(tempDir, "upload.pdf");
    try {
      fs.writeFileSync(tempPath, args.buffer);
      return await this.uploadFirstTime({ subjectId: args.subjectId, pdfPath: tempPath, originalFilename: args.originalFilename });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  /**
   * English Extra Book / Story support V1 (2026-09-20) — uploads an
   * additional PDF for an EXISTING Subject that is NOT its main textbook
   * (e.g. an English "Story" book, distinct from the English course
   * book). Deliberately separate from uploadFirstTime()/uploadFromBuffer()
   * above: never reads or writes Subject.sourceFile — the main textbook
   * mapping is completely untouched. The returned objectKey is
   * deterministic (see defaultExtraBookObjectKey) so a later analyze/
   * confirm step can independently re-derive and verify it rather than
   * trusting a client-supplied key. No Unit/Topic is touched here either
   * — uploading stays inert by the same principle as the main upload.
   */
  async uploadExtraBook(args: { subjectId: string; buffer: Buffer; bookLabel: string }): Promise<ExtraBookUploadResult> {
    const subject = await this.findSubjectWithUnits(args.subjectId);
    const objectKey = defaultExtraBookObjectKey(subject.grade.curriculum.code, subject.grade.level, subject.nameEn, args.bookLabel);

    const tempDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "smartify-extra-book-upload-"));
    const tempPath = path.join(tempDir, "upload.pdf");
    try {
      fs.writeFileSync(tempPath, args.buffer);
      assertLooksLikeRealPdf(tempPath);

      let storedRef: string;
      try {
        storedRef = await this.storageFactory.get().upload(tempPath, objectKey);
      } catch (err) {
        this.logger.error(`Extra-book upload to storage failed for Subject ${args.subjectId}: ${err instanceof Error ? err.message : String(err)}`);
        throw new ServiceUnavailableException("Failed to upload the extra book to storage. Please try again.");
      }
      return { subjectId: subject.id, bookLabel: args.bookLabel, objectKey: storedRef };
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  private async findSubjectWithUnits(subjectId: string): Promise<SubjectWithUnits> {
    const subject = await this.prisma.client.subject.findUnique({
      where: { id: subjectId },
      include: { grade: { include: { curriculum: true } }, units: { select: { id: true, nameEn: true, groundingNotesJson: true } } },
    });
    if (!subject) throw new NotFoundException(`Subject ${subjectId} not found.`);
    return subject as unknown as SubjectWithUnits;
  }

  private warnReplacingGroundedUnits(subject: SubjectWithUnits): void {
    const groundedUnits = subject.units.filter((u) => u.groundingNotesJson != null);
    console.warn(
      `⚠️  Replacing sourceFile for Subject "${subject.nameEn}" (was "${subject.sourceFile}"). ` +
        `${groundedUnits.length} of ${subject.units.length} Unit(s) already have grounding from the OLD source and may now be stale: ` +
        `${groundedUnits.map((u) => u.nameEn).join(", ") || "(none)"}. ` +
        `This command does NOT touch any Unit or Topic — re-ground deliberately via \`pnpm grounding:extract\`/\`pnpm content:regenerate\` if needed.`,
    );
  }

  /**
   * Touches Subject.sourceFile ONLY — no Unit/Topic row is read for any
   * purpose other than the informational --replace warning above, and
   * none is written. Uploading is inert by design.
   *
   * Known, accepted gap (no distributed transaction): if the storage
   * upload succeeds but the subsequent Subject.update fails, the PDF is
   * left sitting in R2 under `objectKey` with no Subject pointing at it
   * yet (an orphan object) — surfaced to the admin caller via the object
   * key in the thrown exception so it can be reconciled manually. This is
   * a deliberately simple tradeoff, not a bug to silently swallow.
   */
  private async storeAndUpdateSubject(subject: { id: string; nameEn: string }, localPath: string, objectKey: string): Promise<CurriculumSourceUploadResult> {
    let storedRef: string;
    try {
      storedRef = await this.storageFactory.get().upload(localPath, objectKey);
    } catch (err) {
      this.logger.error(`Textbook upload to storage failed for Subject ${subject.id}: ${err instanceof Error ? err.message : String(err)}`);
      throw new ServiceUnavailableException("Failed to upload the textbook to storage. Please try again.");
    }

    try {
      await this.prisma.client.subject.update({ where: { id: subject.id }, data: { sourceFile: storedRef } });
    } catch (err) {
      this.logger.error(
        `Subject.sourceFile update failed AFTER a successful storage upload (object key: ${storedRef}) for Subject ${subject.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new InternalServerErrorException(
        `The textbook was uploaded to storage successfully, but recording it on the Subject failed. Reference for support: ${storedRef}. Please retry or contact an engineer.`,
      );
    }

    return { subjectId: subject.id, subjectNameEn: subject.nameEn, sourceFile: storedRef };
  }
}
