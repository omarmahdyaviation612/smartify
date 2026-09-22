import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { loadBackendEnv } from "@smartify/config";
import type { CurriculumSourceStorage } from "./curriculum-source-storage.interface";
import { LocalCurriculumSourceStorage } from "./local-curriculum-source-storage.service";
import { S3CurriculumSourceStorage } from "./s3-curriculum-source-storage.service";

/**
 * Resolves which CurriculumSourceStorage backs Subject.sourceFile —
 * mirrors AIProviderFactory's own "feature code never hardcodes which
 * backend is active" shape. CURRICULUM_STORAGE_PROVIDER picks explicitly;
 * left unset, CURRICULUM_SOURCES_DIR being present means local dev/admin
 * fallback. Neither configured → throws a clear, catchable error (the
 * lazy-grounding path treats this the same as "no source mapped": log +
 * fall back to legacy generation, never crash the student's request).
 */
@Injectable()
export class CurriculumSourceStorageFactory {
  private cached: CurriculumSourceStorage | null = null;

  get(): CurriculumSourceStorage {
    if (this.cached) return this.cached;

    const env = loadBackendEnv();
    if (env.CURRICULUM_STORAGE_PROVIDER === "s3") {
      this.cached = new S3CurriculumSourceStorage();
    } else if (env.CURRICULUM_STORAGE_PROVIDER === "local" || env.CURRICULUM_SOURCES_DIR) {
      this.cached = new LocalCurriculumSourceStorage();
    } else {
      throw new ServiceUnavailableException(
        "No curriculum source storage is configured — set CURRICULUM_STORAGE_PROVIDER=s3 (with CURRICULUM_S3_BUCKET etc.) for production, or CURRICULUM_SOURCES_DIR for local development.",
      );
    }
    return this.cached;
  }
}
