/**
 * One-off, safe manual verification (2026-09-20) — Lesson TTS server-side
 * cache, real R2 storage adapter. Proves TtsAudioCacheService.get()/put()
 * genuinely work against the real private R2 bucket (same CURRICULUM_S3_*
 * config already verified for curriculum uploads), using a tiny synthetic
 * Buffer — NEVER a real synthesized audio clip, NEVER calls OpenAI. The
 * test object is deleted afterward via a standalone S3Client constructed
 * right here in the script (NOT added to TtsAudioCacheService itself,
 * which deliberately has no delete() — see the TTS cache audit/V1 report
 * for why no cleanup infrastructure was added to the service). Safe to
 * delete this script after use.
 */
import "reflect-metadata";
import "dotenv/config";
import * as crypto from "crypto";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { loadBackendEnv } from "@smartify/config";
import { TtsAudioCacheService } from "../tutor/tts/tts-audio-cache.service";

const TEST_KEY = `tts-cache/_verification-test/${crypto.randomBytes(8).toString("hex")}.mp3`;

async function main() {
  const service = new TtsAudioCacheService();
  const syntheticAudio = Buffer.from("SMARTIFY-TTS-CACHE-VERIFICATION-NOT-REAL-AUDIO-" + Date.now());

  console.log("PUT ->", TEST_KEY);
  await service.put(TEST_KEY, syntheticAudio);

  console.log("GET ->", TEST_KEY);
  const readBack = await service.get(TEST_KEY);
  const matches = !!readBack && readBack.equals(syntheticAudio);
  console.log("Bytes round-trip correctly:", matches);

  const missingKey = `tts-cache/_verification-test/${crypto.randomBytes(8).toString("hex")}-does-not-exist.mp3`;
  const miss = await service.get(missingKey);
  console.log("GET on a genuinely nonexistent key returns null:", miss === null);

  // Cleanup — standalone client, deliberately NOT part of the service.
  const env = loadBackendEnv();
  const client = new S3Client({
    region: env.CURRICULUM_S3_REGION || "auto",
    endpoint: env.CURRICULUM_S3_ENDPOINT || undefined,
    forcePathStyle: env.CURRICULUM_S3_FORCE_PATH_STYLE ?? false,
    credentials:
      env.CURRICULUM_S3_ACCESS_KEY_ID && env.CURRICULUM_S3_SECRET_ACCESS_KEY
        ? { accessKeyId: env.CURRICULUM_S3_ACCESS_KEY_ID, secretAccessKey: env.CURRICULUM_S3_SECRET_ACCESS_KEY }
        : undefined,
  });
  await client.send(new DeleteObjectCommand({ Bucket: env.CURRICULUM_S3_BUCKET, Key: TEST_KEY }));
  console.log("DELETE -> test object removed from R2:", TEST_KEY);

  if (!matches) throw new Error("Round-trip verification FAILED — bytes did not match.");
}

main()
  .then(() => {
    console.log("TTS AUDIO CACHE R2 VERIFICATION: SUCCESS");
    process.exit(0);
  })
  .catch((err) => {
    console.error("TTS AUDIO CACHE R2 VERIFICATION FAILED:", err);
    process.exit(1);
  });
