import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pipeline } from "stream/promises";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { loadBackendEnv } from "@smartify/config";
import type { CurriculumSourceContext, CurriculumSourceStorage } from "./curriculum-source-storage.interface";

// Guards against an accidentally huge upload/download consuming disk —
// a real textbook PDF is a few MB to a few dozen MB; 200MB is generous
// headroom, not a real expected size.
const MAX_SOURCE_FILE_SIZE_BYTES = 200 * 1024 * 1024;

/**
 * Private S3-compatible object storage for real textbook PDFs (2026-09-19)
 * — the production counterpart to LocalCurriculumSourceStorage. One SDK
 * (@aws-sdk/client-s3) covers real AWS S3, Cloudflare R2, and MinIO via
 * CURRICULUM_S3_ENDPOINT/CURRICULUM_S3_FORCE_PATH_STYLE, so there's no
 * need for separate vendor-specific SDKs. `sourceRef` here is treated as
 * a full, self-sufficient object key (e.g.
 * "british/year-5/science/student-book.pdf") — unlike the local
 * implementation's bare-filename + derived-directory convention, since a
 * cloud bucket has no reason to mirror that legacy local layout.
 *
 * The bucket MUST be private — nothing here ever generates a public URL,
 * and no signed URL is ever returned to a caller outside this class.
 * Server-side credentials only; never sent to the browser, never logged.
 */
@Injectable()
export class S3CurriculumSourceStorage implements CurriculumSourceStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const env = loadBackendEnv();
    if (!env.CURRICULUM_S3_BUCKET) {
      throw new ServiceUnavailableException("CURRICULUM_S3_BUCKET is not set — cannot use S3 curriculum storage.");
    }
    this.bucket = env.CURRICULUM_S3_BUCKET;
    this.client = new S3Client({
      region: env.CURRICULUM_S3_REGION || "auto",
      endpoint: env.CURRICULUM_S3_ENDPOINT || undefined,
      forcePathStyle: env.CURRICULUM_S3_FORCE_PATH_STYLE ?? false,
      credentials:
        env.CURRICULUM_S3_ACCESS_KEY_ID && env.CURRICULUM_S3_SECRET_ACCESS_KEY
          ? { accessKeyId: env.CURRICULUM_S3_ACCESS_KEY_ID, secretAccessKey: env.CURRICULUM_S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async fetchToTempFile(sourceRef: string, _ctx: CurriculumSourceContext): Promise<{ localPath: string; isTemporary: boolean }> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: sourceRef }));
    if (!response.Body) {
      throw new ServiceUnavailableException(`Curriculum source "${sourceRef}" was found but has no readable content.`);
    }
    const contentLength = response.ContentLength ?? 0;
    if (contentLength > MAX_SOURCE_FILE_SIZE_BYTES) {
      throw new ServiceUnavailableException(`Curriculum source "${sourceRef}" is ${contentLength} bytes — exceeds the ${MAX_SOURCE_FILE_SIZE_BYTES}-byte limit.`);
    }

    const tempDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "smartify-curriculum-source-"));
    const localPath = path.join(tempDir, "source.pdf");
    // Streamed straight to disk, never buffered fully into memory — a
    // multi-hundred-page textbook PDF can be tens of MB.
    await pipeline(response.Body as NodeJS.ReadableStream, fs.createWriteStream(localPath));
    return { localPath, isTemporary: true };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async exists(sourceRef: string, _ctx: CurriculumSourceContext): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: sourceRef }));
      return true;
    } catch {
      return false;
    }
  }

  async upload(localPath: string, objectKey: string): Promise<string> {
    const stats = fs.statSync(localPath);
    if (stats.size > MAX_SOURCE_FILE_SIZE_BYTES) {
      throw new ServiceUnavailableException(`File is ${stats.size} bytes — exceeds the ${MAX_SOURCE_FILE_SIZE_BYTES}-byte limit.`);
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: fs.createReadStream(localPath),
        ContentType: "application/pdf",
        ContentLength: stats.size,
      }),
    );
    return objectKey;
  }
}
