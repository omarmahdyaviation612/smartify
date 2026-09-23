import { execFile } from "child_process";
import { invokePdfRenderer, pdfRendererScript, pdfRendererPython, verifyPdfRenderer } from "./pdf-renderer-runtime";

jest.mock("child_process", () => ({ execFile: jest.fn() }));

describe("PDF renderer readiness", () => {
  const originalEnvironment = process.env.NODE_ENV;
  beforeEach(() => { process.env.NODE_ENV = "production"; });
  afterEach(() => {
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
    jest.restoreAllMocks();
  });

  it("uses the provisioned Linux venv, not a PATH python alias", () => {
    expect(pdfRendererPython("linux")).toBe("/app/.pdf-renderer/bin/python");
    expect(pdfRendererPython("win32", "production")).toBe("/app/.pdf-renderer/bin/python");
    expect(pdfRendererScript()).toBe("/app/packages/database/prisma/tools/render_pdf_pages.py");
  });

  it("checks the actual renderer before startup", async () => {
    (execFile as unknown as jest.Mock).mockImplementation((_cmd, _args, callback) => callback(null, { stdout: "PDF_RENDERER_READY", stderr: "" }));
    await expect(verifyPdfRenderer()).resolves.toBeUndefined();
    expect(execFile).toHaveBeenLastCalledWith("/app/.pdf-renderer/bin/python", [pdfRendererScript(), "--check"], expect.any(Function));
    await invokePdfRenderer(["/tmp/test.pdf", "5", "14", "/tmp/pages"]);
    expect(execFile).toHaveBeenLastCalledWith("/app/.pdf-renderer/bin/python", [pdfRendererScript(), "/tmp/test.pdf", "5", "14", "/tmp/pages"], expect.any(Function));
  });

  it.each(["spawn python ENOENT", "No module named pymupdf", "missing native library", "timeout"])("fails clearly for %s", async (message) => {
    (execFile as unknown as jest.Mock).mockImplementation((_cmd, _args, callback) => callback(new Error(message)));
    await expect(verifyPdfRenderer()).rejects.toThrow("PDF_RENDERER_UNAVAILABLE");
  });
});
