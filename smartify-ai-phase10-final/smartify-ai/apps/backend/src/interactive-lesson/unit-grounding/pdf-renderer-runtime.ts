import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";

// Railpack explicitly builds and ships this venv; do not depend on PATH aliases.
export function pdfRendererPython(platform = process.platform, environment = process.env.NODE_ENV): string {
  return environment === "production" || platform !== "win32" ? "/app/.pdf-renderer/bin/python" : "python";
}

export function pdfRendererScript(): string {
  return process.env.NODE_ENV === "production" || process.platform !== "win32"
    ? "/app/packages/database/prisma/tools/render_pdf_pages.py"
    : path.resolve(__dirname, "..", "..", "..", "..", "..", "packages", "database", "prisma", "tools", "render_pdf_pages.py");
}

const execFileAsync = promisify(execFile);

// The only subprocess boundary for startup, Unit grounding and TOC extraction.
export async function invokePdfRenderer(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const executable = pdfRendererPython();
  const script = pdfRendererScript();
  console.info(`PDF_RENDERER_EXECUTABLE=${executable}`);
  console.info(`PDF_RENDERER_SCRIPT=${script}`);
  return execFileAsync(executable, [script, ...args]);
}

export async function verifyPdfRenderer(): Promise<void> {
  try {
    await invokePdfRenderer(["--check"]);
    console.info("PDF_RENDERER_READY");
  } catch {
    throw new Error("PDF_RENDERER_UNAVAILABLE: Python/PyMuPDF rendering self-check failed. Rebuild with railpack.json and renderer-requirements.txt before serving lessons.");
  }
}
