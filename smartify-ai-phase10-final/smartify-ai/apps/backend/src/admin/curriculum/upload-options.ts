import type { MulterOptions } from "@nestjs/platform-express/multer/interfaces/multer-options.interface";

// Multer 2.2 adds this option; Nest 10's bundled types predate it.
// Smartify accepts flat subjectId/topicId fields, never bracket nesting.
export const uploadOptions: MulterOptions & {
  limits: NonNullable<MulterOptions["limits"]> & { fieldNestingDepth: number };
} = { limits: { fieldNestingDepth: 0 } };
