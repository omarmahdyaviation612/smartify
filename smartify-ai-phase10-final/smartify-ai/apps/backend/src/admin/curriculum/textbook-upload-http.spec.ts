import { BadRequestException, INestApplication, UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AdminCurriculumController } from "./admin-curriculum.controller";
import { AdminCurriculumService } from "./admin-curriculum.service";
import { AUTH_PROVIDER } from "../../auth/auth-provider.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { MAX_SOURCE_FILE_SIZE_BYTES } from "../../interactive-lesson/unit-grounding/storage/curriculum-source-upload.service";
import { textbookUploadOptions } from "./upload-options";

// Real HTTP, real Nest guards, real Multer — mirrors upload-http.spec.ts's
// harness exactly, for the new Step 1 textbook-upload route. No DB, Clerk,
// R2, or AI calls — AdminCurriculumService.uploadSubjectTextbook is mocked
// here; its real behavior is covered by curriculum-source-upload.service.spec.ts.
describe("POST /admin/curriculum/subjects/:id/textbook — real HTTP, real guards, real Multer", () => {
  let app: INestApplication;
  let url: string;
  const uploadSubjectTextbook = jest.fn();
  const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
  const boundary = "smartify-textbook-upload-regression";

  function multipart(options: { bytes?: Buffer; mime?: string; filename?: string; field?: string; omitFile?: boolean } = {}) {
    const chunks: Buffer[] = [];
    if (!options.omitFile) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${options.field ?? "file"}"; filename="${options.filename ?? "science.pdf"}"\r\nContent-Type: ${options.mime ?? "application/pdf"}\r\n\r\n`,
        ),
        options.bytes ?? pdf,
        Buffer.from("\r\n"),
      );
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return Buffer.concat(chunks);
  }

  async function post(body: Buffer, subjectId = "subject-1", token: string | null = "admin") {
    const response = await fetch(`${url}/admin/curriculum/subjects/${subjectId}/textbook`, {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(10000),
    });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, json };
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminCurriculumController],
      providers: [
        { provide: AdminCurriculumService, useValue: { uploadSubjectTextbook } },
        {
          provide: AUTH_PROVIDER,
          useValue: {
            verifySessionToken: async (token: string) => {
              if (token === "invalid") throw new UnauthorizedException();
              return { externalUserId: token };
            },
          },
        },
        {
          provide: PrismaService,
          useValue: {
            client: {
              user: {
                findUnique: async ({ where }: { where: { clerkUserId: string } }) => ({
                  id: "test-user",
                  isActive: true,
                  deletedAt: null,
                  role: where.clerkUserId === "student" ? "STUDENT" : where.clerkUserId === "content-manager-actor" ? "CONTENT_MANAGER" : "ADMIN",
                }),
              },
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    await app.listen(0, "127.0.0.1");
    url = await app.getUrl();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    uploadSubjectTextbook.mockResolvedValue({ subjectId: "subject-1", subjectNameEn: "Science", sourceFile: "british-intl/grade-5/science/science.pdf" });
  });
  afterAll(async () => {
    await app?.close();
  });

  it("accepts a PDF and delegates to the service with the URL's subjectId and the raw memory-buffered file — no replace/force/overwrite field exists anywhere", async () => {
    const { status, json } = await post(multipart());
    expect(status).toBe(201);
    expect(uploadSubjectTextbook).toHaveBeenCalledWith("subject-1", expect.objectContaining({ buffer: pdf, mimetype: "application/pdf", originalname: "science.pdf" }));
    expect(json.sourceFile).toBe("british-intl/grade-5/science/science.pdf");
  });

  it.each(["text/plain", "image/png", "application/octet-stream"])("rejects non-PDF MIME %s before ever calling the service", async (mime) => {
    const { status } = await post(multipart({ mime }));
    expect(status).toBe(400);
    expect(uploadSubjectTextbook).not.toHaveBeenCalled();
  });

  it("rejects a missing file", async () => {
    const { status } = await post(multipart({ omitFile: true }));
    expect(status).toBe(400);
    expect(uploadSubjectTextbook).not.toHaveBeenCalled();
  });

  it("rejects unexpected file field name", async () => {
    const { status } = await post(multipart({ field: "wrongFile" }));
    expect(status).toBe(400);
    expect(uploadSubjectTextbook).not.toHaveBeenCalled();
  });

  it("surfaces the service's 'already has a textbook' refusal as a safe 400 with the exact safe message — never the CLI's --replace wording", async () => {
    uploadSubjectTextbook.mockRejectedValue(new BadRequestException("This subject already has a textbook. Textbook replacement is not enabled yet."));
    const { status, json } = await post(multipart());
    expect(status).toBe(400);
    expect(json.message).toBe("This subject already has a textbook. Textbook replacement is not enabled yet.");
    expect(JSON.stringify(json)).not.toMatch(/--replace/);
  });

  it("does not leak internal error detail (stack trace, storage internals) for an unexpected service failure", async () => {
    uploadSubjectTextbook.mockRejectedValue(new Error("AWS SDK: connection reset by 0447f960...r2.cloudflarestorage.com"));
    const { status, json } = await post(multipart());
    expect(status).toBe(500);
    expect(JSON.stringify(json)).not.toMatch(/AWS|r2\.cloudflarestorage|at Object\.|\.ts:\d+/);
  });

  it.each([null, "invalid", "student"])("rejects unauthorized upload (%s) before the service is ever called", async (token) => {
    const { status } = await post(multipart(), "subject-1", token);
    expect(status).toBe(token === "student" ? 403 : 401);
    expect(uploadSubjectTextbook).not.toHaveBeenCalled();
  });

  it("allows CONTENT_MANAGER — the same role set every other route on this controller (except pricing) already allows", async () => {
    const { status } = await post(multipart(), "subject-1", "content-manager-actor");
    expect(status).toBe(201);
    expect(uploadSubjectTextbook).toHaveBeenCalled();
  });

  it("the route's Multer config enforces the same 200MB ceiling as the shared upload service (transmitting a real 200MB+ body in-test would be impractically slow — this proves the wiring instead of the byte-for-byte enforcement, which Multer/Busboy itself already implements)", () => {
    expect(textbookUploadOptions.limits.fileSize).toBe(MAX_SOURCE_FILE_SIZE_BYTES);
    expect(MAX_SOURCE_FILE_SIZE_BYTES).toBe(200 * 1024 * 1024);
  });
});
