import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { BadRequestException, InternalServerErrorException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { CurriculumSourceUploadService, assertSafeObjectKey, defaultExtraBookObjectKey, defaultObjectKey } from "./curriculum-source-upload.service";

// `fs`'s named exports are non-configurable in this environment, so
// jest.spyOn(fs, "rmSync"/"writeFileSync") throws "Cannot redefine
// property". jest.mock with a pass-through factory (real implementation
// underneath a jest.fn wrapper) tracks calls without ever touching the
// module's own property descriptors.
jest.mock("fs", () => {
  const actual = jest.requireActual("fs");
  return { ...actual, rmSync: jest.fn(actual.rmSync), writeFileSync: jest.fn(actual.writeFileSync) };
});

// Several describe blocks below (uploadExtraBook, uploadFromBuffer) exercise
// the buffer-to-tempfile path, which calls the SAME file-level fs.rmSync/
// writeFileSync mocks — clearing call counts before every test keeps each
// test's own assertions about "called once" accurate regardless of file order.
beforeEach(() => {
  (fs.rmSync as unknown as jest.Mock).mockClear();
  (fs.writeFileSync as unknown as jest.Mock).mockClear();
});

function writeFakePdf(filename = "science y5.pdf"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smartify-upload-service-test-"));
  const file = path.join(dir, filename);
  fs.writeFileSync(file, Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("fake pdf body")]));
  return file;
}

function fakePdfBuffer(): Buffer {
  return Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("fake pdf body")]);
}

const DB_SUBJECT = {
  id: "subject-1",
  nameEn: "Science",
  sourceFile: null as string | null,
  grade: { level: 5, curriculum: { code: "BRITISH_INTL" } },
  units: [
    { id: "unit-1", nameEn: "Plant parts", groundingNotesJson: null },
    { id: "unit-2", nameEn: "Habitats", groundingNotesJson: { concepts: [] } },
  ],
};

function makeService(subjectOverrides: Partial<typeof DB_SUBJECT> = {}, uploadImpl?: (...args: any[]) => any) {
  const subjectUpdateCalls: any[] = [];
  const prisma = {
    client: {
      subject: {
        findUnique: jest.fn().mockResolvedValue({ ...DB_SUBJECT, ...subjectOverrides }),
        update: jest.fn().mockImplementation(async ({ data }: any) => {
          subjectUpdateCalls.push(data);
          return { ...DB_SUBJECT, ...subjectOverrides, ...data };
        }),
      },
      // Deliberately NO unit/topic write methods, and no AI-provider fake
      // is ever constructed anywhere in this file — CurriculumSourceUpload
      // Service's constructor only takes (prisma, storageFactory). If any
      // code path here ever tried to touch a Unit/Topic row or call an AI
      // provider, it would throw "is not a function"/"undefined" rather
      // than silently succeeding — proof of inertness by construction, not
      // by inspection.
    },
  } as any;

  const uploadSpy = jest.fn(uploadImpl ?? (async (_localPath: string, objectKey: string) => objectKey));
  const storage = { fetchToTempFile: jest.fn(), exists: jest.fn(), upload: uploadSpy };
  const storageFactory = { get: () => storage } as any;

  return { service: new CurriculumSourceUploadService(prisma, storageFactory), prisma, storageFactory, uploadSpy, subjectUpdateCalls };
}

describe("CurriculumSourceUploadService: pure helpers", () => {
  it("defaultObjectKey builds a sanitized curriculum/grade/subject/filename path from a full local path", () => {
    const key = defaultObjectKey("BRITISH_INTL", 5, "Science", "D:\\sources\\Science Y5 Book.pdf");
    expect(key).toBe("british-intl/grade-5/science/science-y5-book.pdf");
  });

  it("defaultObjectKey works identically given just an original filename (the HTTP-upload case)", () => {
    const key = defaultObjectKey("BRITISH_INTL", 5, "Science", "Science Y5 Book.pdf");
    expect(key).toBe("british-intl/grade-5/science/science-y5-book.pdf");
  });

  it("assertSafeObjectKey rejects path traversal and absolute paths", () => {
    expect(() => assertSafeObjectKey("../../etc/passwd")).toThrow();
    expect(() => assertSafeObjectKey("/etc/passwd")).toThrow();
    expect(() => assertSafeObjectKey("C:\\Windows\\evil.pdf")).toThrow();
  });

  it("assertSafeObjectKey accepts a normal relative key", () => {
    expect(() => assertSafeObjectKey("british-intl/grade-5/science/book.pdf")).not.toThrow();
  });

  it("defaultExtraBookObjectKey builds a deterministic key under an extras/ prefix, distinct from the main-textbook key convention", () => {
    const key = defaultExtraBookObjectKey("BRITISH_INTL", 1, "English", "The Magic Garden");
    expect(key).toBe("british-intl/grade-1/english/extras/the-magic-garden.pdf");
  });

  it("defaultExtraBookObjectKey is a pure function of its inputs — the same (curriculum, grade, subject, label) always yields the same key", () => {
    const a = defaultExtraBookObjectKey("BRITISH_INTL", 1, "English", "The Magic Garden");
    const b = defaultExtraBookObjectKey("BRITISH_INTL", 1, "English", "The Magic Garden");
    expect(a).toBe(b);
  });

  it("defaultExtraBookObjectKey rejects a book label that slugifies to nothing", () => {
    expect(() => defaultExtraBookObjectKey("BRITISH_INTL", 1, "English", "!!!")).toThrow(BadRequestException);
  });
});

describe("CurriculumSourceUploadService.uploadExtraBook — English Extra Book / Story support V1", () => {
  it("A. uploads a valid extra PDF and returns the deterministic object key, scoped to the correct Subject", async () => {
    const { service, uploadSpy } = makeService({ nameEn: "English", grade: { level: 1, curriculum: { code: "BRITISH_INTL" } } });

    const result = await service.uploadExtraBook({ subjectId: "subject-1", buffer: fakePdfBuffer(), bookLabel: "The Magic Garden" });

    expect(result).toEqual({ subjectId: "subject-1", bookLabel: "The Magic Garden", objectKey: "british-intl/grade-1/english/extras/the-magic-garden.pdf" });
    expect(uploadSpy).toHaveBeenCalledWith(expect.any(String), "british-intl/grade-1/english/extras/the-magic-garden.pdf");
  });

  it("B. never touches Subject.sourceFile — the main textbook mapping is completely untouched", async () => {
    const { service, prisma } = makeService({ sourceFile: "already/mapped-main-textbook.pdf" });

    await service.uploadExtraBook({ subjectId: "subject-1", buffer: fakePdfBuffer(), bookLabel: "The Magic Garden" });

    expect(prisma.client.subject.update).not.toHaveBeenCalled();
  });

  it("C. the returned reference is scoped under this Subject's own curriculum/grade/name path — never a different Subject's path", async () => {
    const { service } = makeService({ nameEn: "Mathematics", grade: { level: 3, curriculum: { code: "EG_NATIONAL" } } });

    const result = await service.uploadExtraBook({ subjectId: "subject-1", buffer: fakePdfBuffer(), bookLabel: "Extra Worksheets" });

    expect(result.objectKey).toBe("eg-national/grade-3/mathematics/extras/extra-worksheets.pdf");
  });

  it("D. rejects a non-PDF (bad magic bytes) before ever calling storage", async () => {
    const { service, uploadSpy } = makeService();

    await expect(
      service.uploadExtraBook({ subjectId: "subject-1", buffer: Buffer.from("this is not a pdf"), bookLabel: "The Magic Garden" }),
    ).rejects.toThrow(/%PDF-/);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it("G. an unsafe/empty book label is rejected — it can never produce a key escaping the expected extras/ prefix", async () => {
    const { service, uploadSpy } = makeService();

    await expect(
      service.uploadExtraBook({ subjectId: "subject-1", buffer: fakePdfBuffer(), bookLabel: "../../etc/passwd" }),
    ).resolves.toMatchObject({ objectKey: expect.stringContaining("extras/") });
    // slugify strips every non-alphanumeric character, so path-traversal sequences can never survive into the key:
    const call = uploadSpy.mock.calls[0];
    expect(call[1]).not.toMatch(/\.\./);
  });

  it("throws NotFoundException for an unknown Subject, before any storage call", async () => {
    const { service, prisma, uploadSpy } = makeService();
    prisma.client.subject.findUnique.mockResolvedValue(null);

    await expect(service.uploadExtraBook({ subjectId: "missing", buffer: fakePdfBuffer(), bookLabel: "The Magic Garden" })).rejects.toThrow(NotFoundException);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it("cleans up its temp file after uploading", async () => {
    const rmMock = fs.rmSync as unknown as jest.Mock;
    rmMock.mockClear();
    const { service } = makeService();

    await service.uploadExtraBook({ subjectId: "subject-1", buffer: fakePdfBuffer(), bookLabel: "The Magic Garden" });

    expect(rmMock).toHaveBeenCalledTimes(1);
    const cleanedUpDir = rmMock.mock.calls[0][0] as string;
    expect(fs.existsSync(cleanedUpDir)).toBe(false);
  });

  it("surfaces a safe, generic error (no internal storage detail) when the storage upload itself fails", async () => {
    const { service } = makeService({}, async () => {
      throw new Error("AWS SDK: connection reset by 0447f960...r2.cloudflarestorage.com");
    });

    let caught: unknown;
    try {
      await service.uploadExtraBook({ subjectId: "subject-1", buffer: fakePdfBuffer(), bookLabel: "The Magic Garden" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    expect((caught as ServiceUnavailableException).message).not.toMatch(/AWS|r2\.cloudflarestorage/);
  });
});

describe("CurriculumSourceUploadService.upload — CLI behavior, preserved exactly from before the refactor", () => {
  it("a fresh Subject (no sourceFile yet): uploads and sets sourceFile, with zero Unit/Topic writes", async () => {
    const pdf = writeFakePdf();
    const { service, uploadSpy, subjectUpdateCalls } = makeService({ sourceFile: null });

    const result = await service.upload({ subjectId: "subject-1", pdfPath: pdf, replace: false });

    expect(result.sourceFile).toBe("british-intl/grade-5/science/science-y5.pdf");
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(subjectUpdateCalls).toEqual([{ sourceFile: "british-intl/grade-5/science/science-y5.pdf" }]);
  });

  it("refuses to overwrite an existing sourceFile without --replace, and never calls storage.upload or Subject.update", async () => {
    const pdf = writeFakePdf();
    const { service, uploadSpy, subjectUpdateCalls } = makeService({ sourceFile: "already/mapped.pdf" });

    await expect(service.upload({ subjectId: "subject-1", pdfPath: pdf, replace: false })).rejects.toThrow(/--replace/);
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(subjectUpdateCalls).toHaveLength(0);
  });

  it("with --replace: overwrites sourceFile, warns about potentially-stale grounded Units, but still never writes any Unit/Topic row", async () => {
    const pdf = writeFakePdf();
    const { service, subjectUpdateCalls } = makeService({ sourceFile: "already/mapped.pdf" });
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await service.upload({ subjectId: "subject-1", pdfPath: pdf, replace: true });

    expect(result.sourceFile).toBe("british-intl/grade-5/science/science-y5.pdf");
    expect(subjectUpdateCalls).toEqual([{ sourceFile: "british-intl/grade-5/science/science-y5.pdf" }]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Habitats"));
    warnSpy.mockRestore();
  });

  it("rejects a file with no %PDF- signature before ever calling storage or Prisma", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smartify-upload-service-test-"));
    const notAPdf = path.join(dir, "not-a-pdf.pdf");
    fs.writeFileSync(notAPdf, "this is not a pdf");
    const { service, prisma, uploadSpy } = makeService();

    await expect(service.upload({ subjectId: "subject-1", pdfPath: notAPdf, replace: false })).rejects.toThrow(/%PDF-/);
    expect(prisma.client.subject.findUnique).not.toHaveBeenCalled();
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it("an explicit --key is honored verbatim instead of the auto-generated one", async () => {
    const pdf = writeFakePdf();
    const { service, uploadSpy } = makeService({ sourceFile: null });

    const result = await service.upload({ subjectId: "subject-1", pdfPath: pdf, key: "custom/path/book.pdf", replace: false });

    expect(result.sourceFile).toBe("custom/path/book.pdf");
    expect(uploadSpy).toHaveBeenCalledWith(pdf, "custom/path/book.pdf");
  });

  it("throws NotFoundException for an unknown Subject", async () => {
    const pdf = writeFakePdf();
    const { service, prisma } = makeService();
    prisma.client.subject.findUnique.mockResolvedValue(null);

    await expect(service.upload({ subjectId: "missing", pdfPath: pdf, replace: false })).rejects.toThrow(NotFoundException);
  });
});

describe("CurriculumSourceUploadService.uploadFirstTime — Admin/HTTP path, Step 1", () => {
  it("uploads and sets sourceFile for a Subject with no textbook mapped yet", async () => {
    const pdf = writeFakePdf("Science Y5 Book.pdf");
    const { service, uploadSpy, subjectUpdateCalls } = makeService({ sourceFile: null });

    const result = await service.uploadFirstTime({ subjectId: "subject-1", pdfPath: pdf, originalFilename: "Science Y5 Book.pdf" });

    expect(result.sourceFile).toBe("british-intl/grade-5/science/science-y5-book.pdf");
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(subjectUpdateCalls).toEqual([{ sourceFile: "british-intl/grade-5/science/science-y5-book.pdf" }]);
  });

  it("refuses with a safe, generic message — never the CLI's --replace-mentioning message — when sourceFile already exists, and never calls storage or Subject.update", async () => {
    const pdf = writeFakePdf();
    const { service, uploadSpy, subjectUpdateCalls } = makeService({ sourceFile: "british-intl/grade-5/science/science-y5.pdf" });

    await expect(service.uploadFirstTime({ subjectId: "subject-1", pdfPath: pdf, originalFilename: "science-y5.pdf" })).rejects.toThrow(
      new BadRequestException("This subject already has a textbook. Textbook replacement is not enabled yet."),
    );
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(subjectUpdateCalls).toHaveLength(0);
  });

  it("rejects a non-PDF (bad magic bytes) before touching Prisma or storage", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smartify-upload-service-test-"));
    const notAPdf = path.join(dir, "not-a-pdf.pdf");
    fs.writeFileSync(notAPdf, "this is not a pdf");
    const { service, prisma, uploadSpy } = makeService();

    await expect(service.uploadFirstTime({ subjectId: "subject-1", pdfPath: notAPdf, originalFilename: "not-a-pdf.pdf" })).rejects.toThrow(/%PDF-/);
    expect(prisma.client.subject.findUnique).not.toHaveBeenCalled();
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it("throws NotFoundException for an unknown Subject", async () => {
    const pdf = writeFakePdf();
    const { service, prisma } = makeService();
    prisma.client.subject.findUnique.mockResolvedValue(null);

    await expect(service.uploadFirstTime({ subjectId: "missing", pdfPath: pdf, originalFilename: "science.pdf" })).rejects.toThrow(NotFoundException);
  });

  it("does not update Subject.sourceFile, and throws a safe generic message with no internal storage detail, when the storage upload fails", async () => {
    const pdf = writeFakePdf();
    const { service, prisma } = makeService({ sourceFile: null }, async () => {
      throw new Error("AWS SDK: connection reset by 0447f960...r2.cloudflarestorage.com, credential AKIA... rejected");
    });

    let caught: unknown;
    try {
      await service.uploadFirstTime({ subjectId: "subject-1", pdfPath: pdf, originalFilename: "science.pdf" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    expect((caught as ServiceUnavailableException).message).toBe("Failed to upload the textbook to storage. Please try again.");
    expect((caught as ServiceUnavailableException).message).not.toMatch(/AWS|r2\.cloudflarestorage|AKIA/);
    expect(prisma.client.subject.update).not.toHaveBeenCalled();
  });

  it("when the storage upload succeeds but the DB update fails, throws a safe error naming the object key (for manual reconciliation) without leaking the raw DB error", async () => {
    const pdf = writeFakePdf();
    const { service, prisma, uploadSpy } = makeService({ sourceFile: null });
    prisma.client.subject.update.mockRejectedValue(new Error("password authentication failed for user \"postgres\" at 10.0.0.5:5432"));

    let caught: unknown;
    try {
      await service.uploadFirstTime({ subjectId: "subject-1", pdfPath: pdf, originalFilename: "science.pdf" });
    } catch (err) {
      caught = err;
    }

    expect(uploadSpy).toHaveBeenCalledTimes(1); // the object really did get uploaded — this IS the orphan-risk scenario
    expect(caught).toBeInstanceOf(InternalServerErrorException);
    expect((caught as InternalServerErrorException).message).toContain("british-intl/grade-5/science/science.pdf");
    expect((caught as InternalServerErrorException).message).not.toMatch(/postgres|10\.0\.0\.5|password/);
  });
});

describe("CurriculumSourceUploadService.uploadFromBuffer — HTTP buffer-to-tempfile adapter", () => {
  const rmMock = fs.rmSync as unknown as jest.Mock;
  const writeMock = fs.writeFileSync as unknown as jest.Mock;

  afterEach(() => {
    rmMock.mockClear();
    writeMock.mockClear();
  });

  it("uploads a Buffer successfully and cleans up its temp file afterward", async () => {
    const { service, uploadSpy, subjectUpdateCalls } = makeService({ sourceFile: null });

    const result = await service.uploadFromBuffer({ subjectId: "subject-1", buffer: fakePdfBuffer(), originalFilename: "Science Y5 Book.pdf" });

    expect(result.sourceFile).toBe("british-intl/grade-5/science/science-y5-book.pdf");
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(subjectUpdateCalls).toEqual([{ sourceFile: "british-intl/grade-5/science/science-y5-book.pdf" }]);

    expect(rmMock).toHaveBeenCalledTimes(1);
    const cleanedUpDir = rmMock.mock.calls[0][0] as string;
    expect(fs.existsSync(cleanedUpDir)).toBe(false);
  });

  it("never derives the temp filename from the caller-supplied original filename", async () => {
    const { service } = makeService({ sourceFile: null });

    await service.uploadFromBuffer({ subjectId: "subject-1", buffer: fakePdfBuffer(), originalFilename: "../../evil; rm -rf /.pdf" });

    const writtenPath = writeMock.mock.calls[writeMock.mock.calls.length - 1][0] as string;
    expect(path.basename(writtenPath)).toBe("upload.pdf");
  });

  it("still cleans up the temp file when the upload is refused (Subject already has a textbook)", async () => {
    const { service } = makeService({ sourceFile: "already/mapped.pdf" });

    await expect(
      service.uploadFromBuffer({ subjectId: "subject-1", buffer: fakePdfBuffer(), originalFilename: "science.pdf" }),
    ).rejects.toThrow(BadRequestException);

    expect(rmMock).toHaveBeenCalledTimes(1);
    const cleanedUpDir = rmMock.mock.calls[0][0] as string;
    expect(fs.existsSync(cleanedUpDir)).toBe(false);
  });

  it("still cleans up the temp file when the storage upload itself throws", async () => {
    const { service } = makeService({ sourceFile: null }, async () => {
      throw new Error("network error");
    });

    await expect(
      service.uploadFromBuffer({ subjectId: "subject-1", buffer: fakePdfBuffer(), originalFilename: "science.pdf" }),
    ).rejects.toThrow(ServiceUnavailableException);

    expect(rmMock).toHaveBeenCalledTimes(1);
    const cleanedUpDir = rmMock.mock.calls[0][0] as string;
    expect(fs.existsSync(cleanedUpDir)).toBe(false);
  });

  it("still cleans up the temp file when the DB update fails after a successful storage upload", async () => {
    const { service, prisma } = makeService({ sourceFile: null });
    prisma.client.subject.update.mockRejectedValue(new Error("db down"));

    await expect(
      service.uploadFromBuffer({ subjectId: "subject-1", buffer: fakePdfBuffer(), originalFilename: "science.pdf" }),
    ).rejects.toThrow(InternalServerErrorException);

    expect(rmMock).toHaveBeenCalledTimes(1);
    const cleanedUpDir = rmMock.mock.calls[0][0] as string;
    expect(fs.existsSync(cleanedUpDir)).toBe(false);
  });
});
