import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { loadBackendEnv } from "@smartify/config";

@Injectable()
export class StudentSupportStorageService {
  private client: S3Client | null = null;
  private bucket: string | null = null;

  private resolve() {
    if (this.client && this.bucket) return { client: this.client, bucket: this.bucket };
    const env = loadBackendEnv();
    if (!env.CURRICULUM_S3_BUCKET) throw new ServiceUnavailableException("Private support image storage is not configured.");
    this.bucket = env.CURRICULUM_S3_BUCKET;
    this.client = new S3Client({ region: env.CURRICULUM_S3_REGION || "auto", endpoint: env.CURRICULUM_S3_ENDPOINT || undefined,
      forcePathStyle: env.CURRICULUM_S3_FORCE_PATH_STYLE ?? false,
      credentials: env.CURRICULUM_S3_ACCESS_KEY_ID && env.CURRICULUM_S3_SECRET_ACCESS_KEY
        ? { accessKeyId: env.CURRICULUM_S3_ACCESS_KEY_ID, secretAccessKey: env.CURRICULUM_S3_SECRET_ACCESS_KEY } : undefined });
    return { client: this.client, bucket: this.bucket };
  }

  async put(key: string, body: Buffer, contentType: string) {
    const { client, bucket } = this.resolve();
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: `student-support/${key}`, Body: body, ContentType: contentType, ContentLength: body.length }));
  }

  async get(key: string): Promise<Buffer> {
    const { client, bucket } = this.resolve();
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `student-support/${key}` }));
    if (!response.Body) throw new ServiceUnavailableException("Support attachment is unavailable.");
    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async delete(key: string) {
    const { client, bucket } = this.resolve();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `student-support/${key}` }));
  }
}
