import * as fs from "fs";
import * as path from "path";
import { BadRequestException, Injectable } from "@nestjs/common";
import { loadBackendEnv } from "@smartify/config";
import type { CurriculumSourceContext, CurriculumSourceStorage } from "./curriculum-source-storage.interface";

/**
 * Dev/admin fallback — resolves Subject.sourceFile against a local
 * directory (CURRICULUM_SOURCES_DIR) on this machine, mirroring the exact
 * directory convention already used by curriculum-pilot/toc-manifests/*.json
 * (bare filename + a curriculum/grade-derived subdirectory). Moved out of
 * UnitGroundingService verbatim (2026-09-19) when production grounding
 * gained a real cloud storage option — this class is what keeps local
 * development and manual admin extraction working exactly as before.
 */
@Injectable()
export class LocalCurriculumSourceStorage implements CurriculumSourceStorage {
  private resolveSourceDir(curriculumCode: string, gradeLevel: number): string | null {
    if (curriculumCode === "BRITISH_INTL") return path.join("British IG", `year ${gradeLevel}`);
    if (curriculumCode === "EG_NATIONAL") return path.join("egypt moe", `grade ${gradeLevel}`);
    return null;
  }

  private resolveLocalPath(sourceRef: string, ctx: CurriculumSourceContext): string {
    const env = loadBackendEnv();
    if (!env.CURRICULUM_SOURCES_DIR) {
      throw new BadRequestException("CURRICULUM_SOURCES_DIR is not set — required when no cloud curriculum storage provider is configured.");
    }
    const sourceDir = this.resolveSourceDir(ctx.curriculumCode, ctx.gradeLevel);
    if (!sourceDir) {
      throw new BadRequestException(`Unknown curriculum code "${ctx.curriculumCode}" — no local source-directory mapping configured for it.`);
    }
    return path.join(env.CURRICULUM_SOURCES_DIR, sourceDir, sourceRef);
  }

  async fetchToTempFile(sourceRef: string, ctx: CurriculumSourceContext): Promise<{ localPath: string; isTemporary: boolean }> {
    const localPath = this.resolveLocalPath(sourceRef, ctx);
    if (!fs.existsSync(localPath)) {
      throw new BadRequestException(`Source PDF not found: ${localPath}`);
    }
    // Never a temp copy — the caller must not delete a real local dev
    // source file when cleaning up.
    return { localPath, isTemporary: false };
  }

  async exists(sourceRef: string, ctx: CurriculumSourceContext): Promise<boolean> {
    try {
      return fs.existsSync(this.resolveLocalPath(sourceRef, ctx));
    } catch {
      return false;
    }
  }

  async upload(_localPath: string, _objectKey: string): Promise<string> {
    throw new BadRequestException(
      "Uploading to local curriculum storage is not supported — copy the PDF into CURRICULUM_SOURCES_DIR manually, following the existing curriculum/grade directory convention.",
    );
  }
}
