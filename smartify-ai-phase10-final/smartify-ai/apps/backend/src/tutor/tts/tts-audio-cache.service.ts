import * as crypto from "crypto";
import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { loadBackendEnv } from "@smartify/config";

// Same private R2 bucket/account/credentials as CurriculumSourceStorage
// (CURRICULUM_S3_*) — this is genuinely just "private object storage on the
// same account", not a curriculum-domain concept, so it deliberately does
// NOT reuse or subclass CurriculumSourceStorage/S3CurriculumSourceStorage:
// that interface is shaped entirely around local-filesystem-path PDF
// handling (fetchToTempFile, CurriculumSourceContext) and a Buffer-based
// audio cache has no use for any of that. A distinct key namespace
// ("tts-cache/...") keeps the two domains apart inside the one bucket.
const LESSON_TTS_CACHE_PREFIX = "tts-cache/lesson/";

/**
 * Deterministic content-addressed cache key for Lesson-originated TTS
 * audio (2026-09-20) — a pure function of exactly what actually affects
 * the synthesized bytes: the final spoken text and the effective
 * model/voice/speed/instructions. Deliberately excludes Topic/student/
 * conversation/message id and UI locale — the whole point is cross-student
 * reuse for identical shared lesson content, keyed on content alone.
 * JSON.stringify of an array (not naive string concatenation) avoids
 * field-boundary collisions, mirroring UnitGroundingService's own
 * fingerprinting approach.
 */
export function computeLessonTtsCacheKey(input: { spokenText: string; model: string; voice: string; speed: number; instructions: string }): string {
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify([input.spokenText, input.model, input.voice, input.speed, input.instructions]))
    .digest("hex");
  return `${LESSON_TTS_CACHE_PREFIX}${hash}.mp3`;
}

/**
 * Minimal private-R2-backed cache for synthesized Lesson TTS audio.
 * Intentionally just two methods — no admin/browse/list surface, no public
 * URL generation ever (matches S3CurriculumSourceStorage's own private-
 * bucket invariant). Lazily resolves its S3Client on first real use
 * (never at DI-container construction time) — mirrors
 * CurriculumSourceStorageFactory's own documented rationale: an
 * unconfigured bucket must never be able to crash the app at boot, only
 * fail the one request that actually needed it, and even then only as a
 * cache-unavailable condition the caller treats as a miss (see
 * TutorSpeechService), never a hard error surfaced to the student.
 */
@Injectable()
export class TtsAudioCacheService {
  private readonly logger = new Logger(TtsAudioCacheService.name);
  private client: S3Client | null = null;
  private bucket: string | null = null;

  private resolve(): { client: S3Client; bucket: string } {
    if (this.client && this.bucket) return { client: this.client, bucket: this.bucket };

    const env = loadBackendEnv();
    if (!env.CURRICULUM_S3_BUCKET) {
      throw new ServiceUnavailableException("TTS audio cache storage is not configured (CURRICULUM_S3_BUCKET unset).");
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
    return { client: this.client, bucket: this.bucket };
  }

  /** Returns the cached audio Buffer, or null when nothing is cached at `key` yet — never throws for a genuine cache miss (only for a real storage failure, which the caller treats as a miss too — see TutorSpeechService). */
  async get(key: string): Promise<Buffer | null> {
    const { client, bucket } = this.resolve();
    let response;
    try {
      response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    } catch (err: any) {
      if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
    if (!response.Body) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /** Writes `audio` to the private cache at `key`. Never generates or returns a public URL. */
  async put(key: string, audio: Buffer): Promise<void> {
    const { client, bucket } = this.resolve();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: audio,
        ContentType: "audio/mpeg",
        ContentLength: audio.length,
      }),
    );
  }
}
