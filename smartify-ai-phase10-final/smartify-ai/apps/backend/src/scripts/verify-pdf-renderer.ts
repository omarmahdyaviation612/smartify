import { verifyPdfRenderer } from "../interactive-lesson/unit-grounding/pdf-renderer-runtime";

// Build-time readiness check only: no application bootstrap, database or AI.
verifyPdfRenderer().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "PDF_RENDERER_UNAVAILABLE");
  process.exitCode = 1;
});
