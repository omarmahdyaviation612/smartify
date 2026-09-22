/**
 * Abstraction over "where does a real textbook PDF actually live" — the
 * ONLY thing UnitGroundingService should know about source-material
 * storage. Two implementations: LocalCurriculumSourceStorage (dev/admin
 * fallback, reads CURRICULUM_SOURCES_DIR on this machine) and
 * S3CurriculumSourceStorage (production — any S3-compatible bucket:
 * AWS S3, Cloudflare R2, MinIO). Neither UnitGroundingService nor any
 * downstream generation code ever branches on which one is active —
 * CurriculumSourceStorageFactory picks based on configuration.
 */
export interface CurriculumSourceStorage {
  /**
   * Resolves `sourceRef` (Subject.sourceFile) to a real local file path
   * ready for the PDF-page renderer. For local storage this is the
   * existing file's own path (no copy); for cloud storage this downloads
   * to a fresh temp file. The caller is responsible for deleting the
   * returned path ONLY if `isTemporary` is true — never delete a local
   * dev source file.
   */
  fetchToTempFile(sourceRef: string, ctx: CurriculumSourceContext): Promise<{ localPath: string; isTemporary: boolean }>;

  /** Cheap existence check — no download, no page rendering. */
  exists(sourceRef: string, ctx: CurriculumSourceContext): Promise<boolean>;

  /** Uploads a local PDF file to storage, returning the reference to persist on Subject.sourceFile. */
  upload(localPath: string, objectKey: string): Promise<string>;
}

export interface CurriculumSourceContext {
  curriculumCode: string;
  gradeLevel: number;
}
