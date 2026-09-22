import { BadRequestException, INestApplication, UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AdminCurriculumController } from "./admin-curriculum.controller";
import { AdminCurriculumService } from "./admin-curriculum.service";
import { AUTH_PROVIDER } from "../../auth/auth-provider.interface";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * English Extra Book / Story support V1 (2026-09-20) — real HTTP, real
 * Nest guards, for the three new extra-book routes. Mirrors
 * subject-ingestion-http.spec.ts's harness exactly. No DB, R2, or AI
 * calls — AdminCurriculumService is fully mocked here.
 */
describe("Admin Extra Book routes — real HTTP, real guards", () => {
  let app: INestApplication;
  let url: string;
  const uploadExtraBook = jest.fn();
  const analyzeExtraBook = jest.fn();
  const confirmExtraBookStructure = jest.fn();
  const boundary = "smartify-extra-book-regression";
  const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");

  function multipart(opts: { bookLabel?: string; bytes?: Buffer; mime?: string; filename?: string; omitFile?: boolean; omitLabel?: boolean } = {}) {
    const chunks: Buffer[] = [];
    if (!opts.omitLabel) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="bookLabel"\r\n\r\n${opts.bookLabel ?? "The Magic Garden"}\r\n`));
    }
    if (!opts.omitFile) {
      chunks.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${opts.filename ?? "story.pdf"}"\r\nContent-Type: ${opts.mime ?? "application/pdf"}\r\n\r\n`),
        opts.bytes ?? pdf,
        Buffer.from("\r\n"),
      );
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return Buffer.concat(chunks);
  }

  async function postMultipart(path: string, body: Buffer, token: string | null = "admin") {
    const response = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(10000),
    });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, json };
  }

  async function postJson(path: string, body: unknown, token: string | null = "admin") {
    const response = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, json };
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminCurriculumController],
      providers: [
        { provide: AdminCurriculumService, useValue: { uploadExtraBook, analyzeExtraBook, confirmExtraBookStructure } },
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
    uploadExtraBook.mockResolvedValue({ subjectId: "subject-1", bookLabel: "The Magic Garden", objectKey: "british-intl/grade-1/english/extras/the-magic-garden.pdf" });
    analyzeExtraBook.mockResolvedValue({ units: [{ nameEn: "Chapter 1", nameAr: "الفصل 1", sourcePageStart: 4, sourcePageEnd: 10, topics: [{ nameEn: "Part A", nameAr: "أ" }] }], pdfPageCount: 40, pagesInspected: { start: 1, end: 10 } });
    confirmExtraBookStructure.mockResolvedValue({ subjectId: "subject-1", unitsCreated: 1, topicsCreated: 1, sourceFileOverride: "british-intl/grade-1/english/extras/the-magic-garden.pdf" });
  });
  afterAll(async () => {
    await app?.close();
  });

  describe("POST /admin/curriculum/subjects/:id/extra-book", () => {
    it("accepts a valid PDF + bookLabel and delegates to the service", async () => {
      const { status, json } = await postMultipart("/admin/curriculum/subjects/subject-1/extra-book", multipart());
      expect(status).toBe(201);
      expect(uploadExtraBook).toHaveBeenCalledWith("subject-1", expect.objectContaining({ buffer: pdf, mimetype: "application/pdf" }), "The Magic Garden");
      expect(json.objectKey).toContain("extras/");
    });

    it("rejects a missing bookLabel before ever calling the service", async () => {
      const { status } = await postMultipart("/admin/curriculum/subjects/subject-1/extra-book", multipart({ omitLabel: true }));
      expect(status).toBe(400);
      expect(uploadExtraBook).not.toHaveBeenCalled();
    });

    it.each(["text/plain", "image/png"])("rejects non-PDF MIME %s before ever calling the service", async (mime) => {
      const { status } = await postMultipart("/admin/curriculum/subjects/subject-1/extra-book", multipart({ mime }));
      expect(status).toBe(400);
      expect(uploadExtraBook).not.toHaveBeenCalled();
    });

    it("rejects a missing file", async () => {
      const { status } = await postMultipart("/admin/curriculum/subjects/subject-1/extra-book", multipart({ omitFile: true }));
      expect(status).toBe(400);
      expect(uploadExtraBook).not.toHaveBeenCalled();
    });

    it.each([null, "invalid", "student"])("E/F. rejects unauthorized callers (%s) before the service is ever called", async (token) => {
      const { status } = await postMultipart("/admin/curriculum/subjects/subject-1/extra-book", multipart(), token);
      expect(status).toBe(token === "student" ? 403 : 401);
      expect(uploadExtraBook).not.toHaveBeenCalled();
    });

    it("allows CONTENT_MANAGER", async () => {
      const { status } = await postMultipart("/admin/curriculum/subjects/subject-1/extra-book", multipart(), "content-manager-actor");
      expect(status).toBe(201);
      expect(uploadExtraBook).toHaveBeenCalled();
    });

    it("does not leak internal error detail for an unexpected service failure", async () => {
      uploadExtraBook.mockRejectedValue(new Error("AWS SDK: connection reset by 0447f960...r2.cloudflarestorage.com"));
      const { status, json } = await postMultipart("/admin/curriculum/subjects/subject-1/extra-book", multipart());
      expect(status).toBe(500);
      expect(JSON.stringify(json)).not.toMatch(/AWS|r2\.cloudflarestorage/);
    });
  });

  describe("POST /admin/curriculum/subjects/:id/extra-book/analyze", () => {
    it("delegates to the service with the URL's subjectId and the bookLabel", async () => {
      const { status, json } = await postJson("/admin/curriculum/subjects/subject-1/extra-book/analyze", { bookLabel: "The Magic Garden" });
      expect(status).toBe(201);
      expect(analyzeExtraBook).toHaveBeenCalledWith("subject-1", "The Magic Garden");
      expect(json.units).toHaveLength(1);
    });

    it("rejects a missing bookLabel before ever calling the service", async () => {
      const { status } = await postJson("/admin/curriculum/subjects/subject-1/extra-book/analyze", {});
      expect(status).toBe(400);
      expect(analyzeExtraBook).not.toHaveBeenCalled();
    });

    it.each([null, "invalid", "student"])("rejects unauthorized callers (%s) before the service is ever called", async (token) => {
      const { status } = await postJson("/admin/curriculum/subjects/subject-1/extra-book/analyze", { bookLabel: "The Magic Garden" }, token);
      expect(status).toBe(token === "student" ? 403 : 401);
      expect(analyzeExtraBook).not.toHaveBeenCalled();
    });

    it("'no TOC found' surfaces as a safe 400 — never a raw internal error", async () => {
      analyzeExtraBook.mockRejectedValue(new BadRequestException("Could not find a usable table of contents in pages 1-20 of this PDF."));
      const { status, json } = await postJson("/admin/curriculum/subjects/subject-1/extra-book/analyze", { bookLabel: "The Magic Garden" });
      expect(status).toBe(400);
      expect(json.message).toMatch(/table of contents/);
    });
  });

  describe("POST /admin/curriculum/subjects/:id/extra-book/confirm", () => {
    const VALID_BODY = {
      bookLabel: "The Magic Garden",
      units: [{ nameEn: "Story — The Magic Garden", nameAr: "قصة", sourcePageStart: 4, sourcePageEnd: 35, topics: [{ nameEn: "Chapter 1", nameAr: "الفصل 1" }] }],
    };

    it("delegates to the service with the URL's subjectId and the parsed body", async () => {
      const { status, json } = await postJson("/admin/curriculum/subjects/subject-1/extra-book/confirm", VALID_BODY);
      expect(status).toBe(201);
      expect(confirmExtraBookStructure).toHaveBeenCalledWith("subject-1", VALID_BODY);
      expect(json.unitsCreated).toBe(1);
    });

    it.each([null, "invalid", "student"])("rejects unauthorized callers (%s) before the service is ever called", async (token) => {
      const { status } = await postJson("/admin/curriculum/subjects/subject-1/extra-book/confirm", VALID_BODY, token);
      expect(status).toBe(token === "student" ? 403 : 401);
      expect(confirmExtraBookStructure).not.toHaveBeenCalled();
    });

    it("allows CONTENT_MANAGER", async () => {
      const { status } = await postJson("/admin/curriculum/subjects/subject-1/extra-book/confirm", VALID_BODY, "content-manager-actor");
      expect(status).toBe(201);
      expect(confirmExtraBookStructure).toHaveBeenCalled();
    });

    it("rejects a malformed body (missing bookLabel) before ever calling the service", async () => {
      const { status } = await postJson("/admin/curriculum/subjects/subject-1/extra-book/confirm", { units: VALID_BODY.units });
      expect(status).toBe(400);
      expect(confirmExtraBookStructure).not.toHaveBeenCalled();
    });

    it("rejects a unit with no topics before ever calling the service", async () => {
      const badBody = { bookLabel: "The Magic Garden", units: [{ nameEn: "U", nameAr: "و", sourcePageStart: 1, sourcePageEnd: 5, topics: [] }] };
      const { status } = await postJson("/admin/curriculum/subjects/subject-1/extra-book/confirm", badBody);
      expect(status).toBe(400);
      expect(confirmExtraBookStructure).not.toHaveBeenCalled();
    });

    it("rejects an unrecognized extra field (strict schema, e.g. a curriculumId/gradeId that doesn't belong on this endpoint)", async () => {
      const { status } = await postJson("/admin/curriculum/subjects/subject-1/extra-book/confirm", { ...VALID_BODY, curriculumId: "should-not-be-here" });
      expect(status).toBe(400);
      expect(confirmExtraBookStructure).not.toHaveBeenCalled();
    });

    it("surfaces the service's 'already added' refusal as a safe 400", async () => {
      confirmExtraBookStructure.mockRejectedValue(new BadRequestException("This extra book has already been added to this subject."));
      const { status, json } = await postJson("/admin/curriculum/subjects/subject-1/extra-book/confirm", VALID_BODY);
      expect(status).toBe(400);
      expect(json.message).toBe("This extra book has already been added to this subject.");
    });

    it("does not leak internal error detail (Prisma/stack trace) for an unexpected service failure", async () => {
      confirmExtraBookStructure.mockRejectedValue(new Error("PrismaClientKnownRequestError: Unique constraint failed at PrismaClient._request"));
      const { status, json } = await postJson("/admin/curriculum/subjects/subject-1/extra-book/confirm", VALID_BODY);
      expect(status).toBe(500);
      expect(JSON.stringify(json)).not.toMatch(/PrismaClient|\.ts:\d+/);
    });
  });
});
