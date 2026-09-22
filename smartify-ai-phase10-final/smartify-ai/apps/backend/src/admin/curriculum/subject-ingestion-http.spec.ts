import { BadRequestException, INestApplication, UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AdminCurriculumController } from "./admin-curriculum.controller";
import { AdminCurriculumService } from "./admin-curriculum.service";
import { AUTH_PROVIDER } from "../../auth/auth-provider.interface";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * Admin New Subject + Textbook Ingestion V1 (2026-09-20) — real HTTP, real
 * Nest guards, for the two new routes (analyze-textbook, confirm-structure).
 * Mirrors textbook-upload-http.spec.ts's harness exactly. No DB, R2, or AI
 * calls — AdminCurriculumService is fully mocked here; TocExtractionService's
 * own behavior is covered by toc-extraction.service.spec.ts, and
 * AdminCurriculumService's own logic by subject-confirmation.service.spec.ts.
 */
describe("Admin New Subject ingestion routes — real HTTP, real guards", () => {
  let app: INestApplication;
  let url: string;
  const analyzeSubjectTextbook = jest.fn();
  const confirmSubjectStructure = jest.fn();

  async function post(path: string, body: unknown, token: string | null = "admin") {
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
        { provide: AdminCurriculumService, useValue: { analyzeSubjectTextbook, confirmSubjectStructure } },
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
    analyzeSubjectTextbook.mockResolvedValue({ units: [{ nameEn: "Unit 1", nameAr: "وحدة 1", sourcePageStart: 1, sourcePageEnd: 10, topics: [{ nameEn: "Topic 1", nameAr: "موضوع 1" }] }], pdfPageCount: 50, pagesInspected: { start: 1, end: 10 } });
    confirmSubjectStructure.mockResolvedValue({ subjectId: "subject-1", unitsCreated: 1, topicsCreated: 1 });
  });
  afterAll(async () => {
    await app?.close();
  });

  const VALID_CONFIRM_BODY = {
    curriculumId: "clcurriculum000000000001",
    gradeId: "clgrade0000000000000001",
    units: [
      { nameEn: "Unit 1", nameAr: "وحدة 1", sourcePageStart: 1, sourcePageEnd: 10, topics: [{ nameEn: "Topic 1", nameAr: "موضوع 1" }] },
    ],
  };

  describe("POST /admin/curriculum/subjects/:id/analyze-textbook", () => {
    it("delegates to the service with the URL's subjectId and returns its preview structure", async () => {
      const { status, json } = await post("/admin/curriculum/subjects/subject-1/analyze-textbook", undefined);
      expect(status).toBe(201);
      expect(analyzeSubjectTextbook).toHaveBeenCalledWith("subject-1");
      expect(json.units).toHaveLength(1);
    });

    it.each([null, "invalid", "student"])("rejects unauthorized callers (%s) before the service is ever called", async (token) => {
      const { status } = await post("/admin/curriculum/subjects/subject-1/analyze-textbook", undefined, token);
      expect(status).toBe(token === "student" ? 403 : 401);
      expect(analyzeSubjectTextbook).not.toHaveBeenCalled();
    });

    it("allows CONTENT_MANAGER — the same role set every other content-management route on this controller allows", async () => {
      const { status } = await post("/admin/curriculum/subjects/subject-1/analyze-textbook", undefined, "content-manager-actor");
      expect(status).toBe(201);
      expect(analyzeSubjectTextbook).toHaveBeenCalled();
    });

    it("surfaces the service's safe refusal message as a 400, never a raw internal detail", async () => {
      analyzeSubjectTextbook.mockRejectedValue(new BadRequestException("Upload a textbook before analyzing it."));
      const { status, json } = await post("/admin/curriculum/subjects/subject-1/analyze-textbook", undefined);
      expect(status).toBe(400);
      expect(json.message).toBe("Upload a textbook before analyzing it.");
    });

    it("does not leak internal error detail for an unexpected service failure", async () => {
      analyzeSubjectTextbook.mockRejectedValue(new Error("OpenAI 500: rate limit exceeded, key sk-abc123..."));
      const { status, json } = await post("/admin/curriculum/subjects/subject-1/analyze-textbook", undefined);
      expect(status).toBe(500);
      expect(JSON.stringify(json)).not.toMatch(/sk-abc123|OpenAI|at Object\.|\.ts:\d+/);
    });
  });

  describe("POST /admin/curriculum/subjects/:id/confirm-structure", () => {
    it("delegates to the service with the URL's subjectId and the parsed body, returning creation counts", async () => {
      const { status, json } = await post("/admin/curriculum/subjects/subject-1/confirm-structure", VALID_CONFIRM_BODY);
      expect(status).toBe(201);
      expect(confirmSubjectStructure).toHaveBeenCalledWith("subject-1", VALID_CONFIRM_BODY);
      expect(json).toEqual({ subjectId: "subject-1", unitsCreated: 1, topicsCreated: 1 });
    });

    it.each([null, "invalid", "student"])("rejects unauthorized callers (%s) before the service is ever called", async (token) => {
      const { status } = await post("/admin/curriculum/subjects/subject-1/confirm-structure", VALID_CONFIRM_BODY, token);
      expect(status).toBe(token === "student" ? 403 : 401);
      expect(confirmSubjectStructure).not.toHaveBeenCalled();
    });

    it("allows CONTENT_MANAGER", async () => {
      const { status } = await post("/admin/curriculum/subjects/subject-1/confirm-structure", VALID_CONFIRM_BODY, "content-manager-actor");
      expect(status).toBe(201);
      expect(confirmSubjectStructure).toHaveBeenCalled();
    });

    it("rejects a malformed body (missing units) with 400 before ever calling the service", async () => {
      const { status } = await post("/admin/curriculum/subjects/subject-1/confirm-structure", { curriculumId: VALID_CONFIRM_BODY.curriculumId, gradeId: VALID_CONFIRM_BODY.gradeId });
      expect(status).toBe(400);
      expect(confirmSubjectStructure).not.toHaveBeenCalled();
    });

    it("rejects a body with an empty units array before ever calling the service", async () => {
      const { status } = await post("/admin/curriculum/subjects/subject-1/confirm-structure", { ...VALID_CONFIRM_BODY, units: [] });
      expect(status).toBe(400);
      expect(confirmSubjectStructure).not.toHaveBeenCalled();
    });

    it("rejects a unit with no topics before ever calling the service", async () => {
      const badBody = { ...VALID_CONFIRM_BODY, units: [{ nameEn: "U", nameAr: "و", sourcePageStart: 1, sourcePageEnd: 5, topics: [] }] };
      const { status } = await post("/admin/curriculum/subjects/subject-1/confirm-structure", badBody);
      expect(status).toBe(400);
      expect(confirmSubjectStructure).not.toHaveBeenCalled();
    });

    it("rejects an unrecognized extra field (strict schema)", async () => {
      const { status } = await post("/admin/curriculum/subjects/subject-1/confirm-structure", { ...VALID_CONFIRM_BODY, extraField: "nope" });
      expect(status).toBe(400);
      expect(confirmSubjectStructure).not.toHaveBeenCalled();
    });

    it("surfaces the service's 'already has curriculum structure' refusal as a safe 400", async () => {
      confirmSubjectStructure.mockRejectedValue(new BadRequestException("This subject already has curriculum structure — confirmation can only run once."));
      const { status, json } = await post("/admin/curriculum/subjects/subject-1/confirm-structure", VALID_CONFIRM_BODY);
      expect(status).toBe(400);
      expect(json.message).toBe("This subject already has curriculum structure — confirmation can only run once.");
    });

    it("does not leak internal error detail (Prisma/stack trace) for an unexpected service failure", async () => {
      confirmSubjectStructure.mockRejectedValue(new Error("PrismaClientKnownRequestError: Unique constraint failed on the fields: (`id`) at PrismaClient._request"));
      const { status, json } = await post("/admin/curriculum/subjects/subject-1/confirm-structure", VALID_CONFIRM_BODY);
      expect(status).toBe(500);
      expect(JSON.stringify(json)).not.toMatch(/PrismaClient|at .*\(|\.ts:\d+/);
    });
  });
});
