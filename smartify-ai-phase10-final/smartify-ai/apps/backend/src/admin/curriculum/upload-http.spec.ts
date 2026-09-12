import { INestApplication, UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createRequire } from "node:module";
import { AdminCurriculumController } from "./admin-curriculum.controller";
import { AdminCurriculumService } from "./admin-curriculum.service";
import { AUTH_PROVIDER } from "../../auth/auth-provider.interface";
import { PrismaService } from "../../prisma/prisma.service";

// Real HTTP, Nest guards, FileInterceptor and Multer; no DB, Clerk or AI calls.
describe("multipart upload compatibility", () => {
  let app: INestApplication;
  let url: string;
  const importSubjectMaterial = jest.fn();
  const createMaterial = jest.fn();
  const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
  const boundary = "smartify-upload-regression";

  function multipart(options: { bytes?: Buffer; mime?: string; filename?: string; field?: string; id?: string; omitFile?: boolean } = {}) {
    const chunks: Buffer[] = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${options.id ?? "subjectId"}"\r\n\r\nsubject-test\r\n`)];
    if (!options.omitFile) chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${options.field ?? "file"}"; filename="${options.filename ?? "lesson.pdf"}"\r\nContent-Type: ${options.mime ?? "application/pdf"}\r\n\r\n`),
      options.bytes ?? pdf, Buffer.from("\r\n"),
    );
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return Buffer.concat(chunks);
  }

  async function post(body: Buffer, route = "subject-materials", token: string | null = "admin", contentType = `multipart/form-data; boundary=${boundary}`) {
    const response = await fetch(`${url}/admin/curriculum/${route}`, {
      method: "POST", headers: { "content-type": contentType, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: new Uint8Array(body), signal: AbortSignal.timeout(10000),
    });
    await response.text();
    return response.status;
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminCurriculumController],
      providers: [
        { provide: AdminCurriculumService, useValue: { importSubjectMaterial, createMaterial } },
        { provide: AUTH_PROVIDER, useValue: { verifySessionToken: async (token: string) => {
          if (token === "invalid") throw new UnauthorizedException();
          return { externalUserId: token };
        } } },
        { provide: PrismaService, useValue: { client: { user: { findUnique: async ({ where }: { where: { clerkUserId: string } }) => ({
          id: "test-user", isActive: true, deletedAt: null, role: where.clerkUserId === "student" ? "STUDENT" : "ADMIN",
        }) } } } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    await app.listen(0, "127.0.0.1");
    url = await app.getUrl();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    importSubjectMaterial.mockResolvedValue({ unitId: "mock-unit" });
    createMaterial.mockResolvedValue({ id: "mock-material" });
  });
  afterAll(async () => { await app?.close(); });

  it("accepts PDF multipart bytes and passes the subject and buffer unchanged", async () => {
    expect(await post(multipart())).toBe(201);
    expect(importSubjectMaterial).toHaveBeenCalledWith("subject-test", expect.objectContaining({ buffer: pdf, mimetype: "application/pdf", originalname: "lesson.pdf", size: pdf.length }));
  });
  it.each(["text/plain", "image/png", "application/octet-stream"])("rejects non-PDF MIME %s even with a .pdf name", async mime => {
    expect(await post(multipart({ mime }))).toBe(400);
    expect(importSubjectMaterial).not.toHaveBeenCalled();
  });
  it("records existing behavior: PDF MIME is trusted regardless of extension/content at controller boundary", async () => {
    expect(await post(multipart({ filename: "not-pdf.txt", bytes: Buffer.from("not a PDF") }))).toBe(201);
  });
  it("accepts exactly 25 MiB and rejects 25 MiB plus one after buffering", async () => {
    expect(await post(multipart({ bytes: Buffer.alloc(25 * 1024 * 1024, 65) }))).toBe(201);
    importSubjectMaterial.mockClear();
    expect(await post(multipart({ bytes: Buffer.alloc(25 * 1024 * 1024 + 1, 65) }))).toBe(400);
    expect(importSubjectMaterial).not.toHaveBeenCalled();
  });
  it("preserves legacy text upload and its 5 MiB limit", async () => {
    expect(await post(multipart({ id: "topicId", mime: "text/plain", bytes: Buffer.alloc(5 * 1024 * 1024, 65) }), "materials")).toBe(201);
    createMaterial.mockClear();
    expect(await post(multipart({ id: "topicId", mime: "text/plain", bytes: Buffer.alloc(5 * 1024 * 1024 + 1, 65) }), "materials")).toBe(400);
    expect(createMaterial).not.toHaveBeenCalled();
  });
  it.each(["materials", "subject-materials"])("rejects missing file on %s", async route => {
    expect(await post(multipart({ omitFile: true }), route)).toBe(400);
  });
  it("rejects missing subject", async () => {
    expect(await post(multipart({ id: "wrongId" }))).toBe(400);
  });
  it("rejects unexpected file field", async () => {
    expect(await post(multipart({ field: "wrongFile" }))).toBe(400);
  });
  it("rejects absent multipart boundary", async () => {
    expect(await post(multipart(), "subject-materials", "admin", "multipart/form-data")).toBe(400);
  });
  it("rejects truncated multipart and remains responsive", async () => {
    expect(await post(multipart().subarray(0, -40))).toBe(400);
    expect(await post(multipart())).toBe(201);
  });
  it.each([null, "invalid", "student"])("rejects unauthorized upload (%s) before service invocation", async token => {
    expect(await post(multipart(), "subject-materials", token)).toBe(token === "student" ? 403 : 401);
    expect(importSubjectMaterial).not.toHaveBeenCalled();
  });
  it.each(["../../lesson.pdf", "C:\\fakepath\\lesson.pdf"])("strips directory components from filename %s and uses memory storage", async filename => {
    expect(await post(multipart({ filename }))).toBe(201);
    const file = importSubjectMaterial.mock.calls[0][1];
    expect(file.originalname).toBe("lesson.pdf");
    expect(file.path).toBeUndefined();
    expect(file.buffer).toEqual(pdf);
  });
  it("records pre-existing legacy PDF argument bug without invoking real service", async () => {
    expect(await post(multipart(), "materials")).toBe(201);
    const [subject, file] = importSubjectMaterial.mock.calls[0];
    expect(subject).toBe(file);
  });
  it("rejects multipart text fields larger than Multer default 1 MiB", async () => {
    const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="subjectId"\r\n\r\n${"a".repeat(1024 * 1024 + 1)}\r\n--${boundary}--\r\n`);
    expect(await post(body)).toBe(400);
  });
  it("blocks excessive multipart field nesting before the upload service", async () => {
    const nested = `extra${"[a]".repeat(100)}`;
    const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${nested}"\r\n\r\nx\r\n`);
    expect(await post(Buffer.concat([prefix, multipart()]))).toBeGreaterThanOrEqual(400);
    expect(importSubjectMaterial).not.toHaveBeenCalled();
    expect(await post(multipart())).toBe(201);
  });
  it("resolves the minimum patched Multer through Nest's adapter", () => {
    const fromNest = createRequire(require.resolve("@nestjs/platform-express"));
    expect(fromNest("multer/package.json").version).toBe("2.2.0");
  });
});
