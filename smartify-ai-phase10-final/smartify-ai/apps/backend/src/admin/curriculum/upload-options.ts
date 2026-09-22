import type { MulterOptions } from "@nestjs/platform-express/multer/interfaces/multer-options.interface";
import { MAX_SOURCE_FILE_SIZE_BYTES } from "../../interactive-lesson/unit-grounding/storage/curriculum-source-upload.service";

// Multer 2.2 adds this option; Nest 10's bundled types predate it.
// Smartify accepts flat subjectId/topicId fields, never bracket nesting.
export const uploadOptions: MulterOptions & {
  limits: NonNullable<MulterOptions["limits"]> & { fieldNestingDepth: number };
} = { limits: { fieldNestingDepth: 0 } };

// Separate from uploadOptions above (the legacy /materials, /subject-materials
// routes keep their existing, unbounded-at-Multer-level behavior untouched).
// The 200MB ceiling here is enforced by Multer/Busboy itself before the
// buffer is even fully accepted — CurriculumSourceUploadService's own
// magic-byte check (assertLooksLikeRealPdf) is a second, authoritative
// layer, never the only one.
export const textbookUploadOptions: MulterOptions & {
  limits: NonNullable<MulterOptions["limits"]> & { fieldNestingDepth: number; fileSize: number };
} = { limits: { fieldNestingDepth: 0, fileSize: MAX_SOURCE_FILE_SIZE_BYTES } };
