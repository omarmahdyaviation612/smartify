import { ForbiddenException, INestApplication, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TutorController } from "./tutor.controller";
import { TutorService } from "./tutor.service";
import { TutorSpeechService } from "./tutor-speech.service";
import { AUTH_PROVIDER } from "../auth/auth-provider.interface";
import { PrismaService } from "../prisma/prisma.service";
import { GlobalExceptionFilter } from "../common/filters/global-exception.filter";

/**
 * Real HTTP, real ClerkAuthGuard, and the REAL GlobalExceptionFilter
 * production registers — proves an unauthenticated caller can never reach
 * the Tutor, and that provider-boundary failures (Phase 8) come back as a
 * useful, non-crashing response that never leaks internal error detail
 * (which could otherwise carry a provider hostname/URL or SDK error text)
 * to the client.
 */
describe("tutor HTTP authorization and failure-safety", () => {
  let app: INestApplication;
  let url: string;
  const sendMessage = jest.fn();
  const getRemainingToday = jest.fn();
  const synthesize = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TutorController],
      providers: [
        { provide: TutorService, useValue: { sendMessage, getRemainingToday, listConversations: jest.fn(), getConversation: jest.fn() } },
        { provide: TutorSpeechService, useValue: { synthesize } },
        { provide: AUTH_PROVIDER, useValue: { verifySessionToken: async (token: string) => {
          if (token === "invalid") throw new UnauthorizedException();
          return { externalUserId: token };
        } } },
        { provide: PrismaService, useValue: { client: { user: { findUnique: async () => ({ id: "local-user-1", isActive: true, deletedAt: null, role: "STUDENT" }) } } } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.listen(0, "127.0.0.1");
    url = await app.getUrl();
  });
  afterAll(async () => app?.close());
  beforeEach(() => jest.clearAllMocks());

  it("rejects an unauthenticated POST /tutor/message before touching the service", async () => {
    const res = await fetch(`${url}/tutor/message`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ subjectId: "s1", message: "hi" }),
    });
    expect(res.status).toBe(401);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated GET /tutor/remaining", async () => {
    const res = await fetch(`${url}/tutor/remaining?subjectId=s1`);
    expect(res.status).toBe(401);
    expect(getRemainingToday).not.toHaveBeenCalled();
  });

  it("rejects an invalid/expired token", async () => {
    const res = await fetch(`${url}/tutor/remaining?subjectId=s1`, { headers: { authorization: "Bearer invalid" } });
    expect(res.status).toBe(401);
  });

  it("returns 403 with a useful message (not a crash) when the free trial is exhausted", async () => {
    sendMessage.mockRejectedValue(new ForbiddenException("Your free trial is complete. Subscribe to continue."));
    const res = await fetch(`${url}/tutor/message`, {
      method: "POST", headers: { authorization: "Bearer own-user", "content-type": "application/json" },
      body: JSON.stringify({ subjectId: "s1", message: "hi" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toMatch(/free trial/i);
  });

  it("returns 503 with a generic provider message, never the SDK's internal error text or any secret, when the provider is unavailable", async () => {
    sendMessage.mockRejectedValue(new ServiceUnavailableException("AI Tutor is not configured yet — OPENAI_API_KEY is missing on the backend."));
    const res = await fetch(`${url}/tutor/message`, {
      method: "POST", headers: { authorization: "Bearer own-user", "content-type": "application/json" },
      body: JSON.stringify({ subjectId: "s1", message: "hi" }),
    });
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toMatch(/sk-|gsk_|api[_-]?key\s*[:=]\s*\S{10,}/i);
  });

  it("converts a raw unexpected provider error (e.g. a network/timeout exception) into a safe generic 500, never leaking the original error text", async () => {
    sendMessage.mockRejectedValue(new Error("connect ETIMEDOUT 10.0.0.5:443 upstream=https://api.internal.example/secret-path"));
    const res = await fetch(`${url}/tutor/message`, {
      method: "POST", headers: { authorization: "Bearer own-user", "content-type": "application/json" },
      body: JSON.stringify({ subjectId: "s1", message: "hi" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).toBe("An unexpected error occurred.");
    expect(JSON.stringify(body)).not.toMatch(/ETIMEDOUT|10\.0\.0\.5|secret-path/);
  });

  it("scopes /tutor/message to the authenticated user's own local id, never a client-supplied id", async () => {
    sendMessage.mockResolvedValue({ conversationId: "c1", reply: "ok", isAiGenerated: true, remainingToday: 1, dailyLimit: 2 });
    await fetch(`${url}/tutor/message`, {
      method: "POST", headers: { authorization: "Bearer own-user", "content-type": "application/json" },
      body: JSON.stringify({ subjectId: "s1", message: "hi", userId: "someone-else" }),
    });
    expect(sendMessage).toHaveBeenCalledWith("local-user-1", expect.objectContaining({ subjectId: "s1", message: "hi" }));
  });

  describe("/tutor/speech — voice playback (never quota-gated)", () => {
    it("rejects an unauthenticated request", async () => {
      const res = await fetch(`${url}/tutor/speech`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      });
      expect(res.status).toBe(401);
      expect(synthesize).not.toHaveBeenCalled();
    });

    it("returns audio bytes with an audio content-type and no-store caching, scoped to the caller's own id", async () => {
      synthesize.mockResolvedValue(Buffer.from([0xff, 0xfb, 0x00]));
      const res = await fetch(`${url}/tutor/speech`, {
        method: "POST", headers: { authorization: "Bearer own-user", "content-type": "application/json" },
        body: JSON.stringify({ text: "Photosynthesis is a process.", conversationId: "c1" }),
      });
      expect(res.status).toBe(201); // Nest's default POST status — matches every other mutation-shaped endpoint in this codebase
      expect(res.headers.get("content-type")).toBe("audio/mpeg");
      expect(res.headers.get("cache-control")).toContain("no-store");
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(Array.from(bytes)).toEqual([0xff, 0xfb, 0x00]);
      expect(synthesize).toHaveBeenCalledWith({ userId: "local-user-1", conversationId: "c1", text: "Photosynthesis is a process." });
    });

    it("never calls TutorService.sendMessage — speech generation is independent of the quota-consuming path", async () => {
      synthesize.mockResolvedValue(Buffer.from([1, 2, 3]));
      await fetch(`${url}/tutor/speech`, {
        method: "POST", headers: { authorization: "Bearer own-user", "content-type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      });
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("returns a safe generic error, never provider detail, when speech generation is unavailable", async () => {
      synthesize.mockRejectedValue(new ServiceUnavailableException("Voice playback is not configured yet — OPENAI_API_KEY is missing on the backend."));
      const res = await fetch(`${url}/tutor/speech`, {
        method: "POST", headers: { authorization: "Bearer own-user", "content-type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      });
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).not.toMatch(/sk-|gsk_/i);
    });
  });
});
