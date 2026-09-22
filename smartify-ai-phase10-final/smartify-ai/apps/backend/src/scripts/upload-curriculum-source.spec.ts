import { parseArgs } from "./upload-curriculum-source";

/**
 * The real upload logic moved to CurriculumSourceUploadService
 * (curriculum-source-upload.service.spec.ts) as part of the 2026-09-20
 * Admin textbook upload refactor — this script is now a thin CLI wrapper,
 * so its own tests are limited to what's genuinely CLI-specific: argument
 * parsing.
 */
describe("upload-curriculum-source CLI: parseArgs", () => {
  it("parses required --subjectId and --pdf", () => {
    const args = parseArgs(["--subjectId=subj-1", "--pdf=/path/to/book.pdf"]);
    expect(args).toEqual({ subjectId: "subj-1", pdf: "/path/to/book.pdf", key: undefined, replace: false });
  });

  it("parses an optional --key", () => {
    const args = parseArgs(["--subjectId=subj-1", "--pdf=/path/to/book.pdf", "--key=custom/key.pdf"]);
    expect(args.key).toBe("custom/key.pdf");
  });

  it("parses the --replace flag regardless of position", () => {
    const args = parseArgs(["--replace", "--subjectId=subj-1", "--pdf=/path/to/book.pdf"]);
    expect(args.replace).toBe(true);
  });

  it("defaults replace to false when not passed", () => {
    const args = parseArgs(["--subjectId=subj-1", "--pdf=/path/to/book.pdf"]);
    expect(args.replace).toBe(false);
  });

  it("throws when --subjectId is missing", () => {
    expect(() => parseArgs(["--pdf=/path/to/book.pdf"])).toThrow(/Missing required arguments/);
  });

  it("throws when --pdf is missing", () => {
    expect(() => parseArgs(["--subjectId=subj-1"])).toThrow(/Missing required arguments/);
  });
});
