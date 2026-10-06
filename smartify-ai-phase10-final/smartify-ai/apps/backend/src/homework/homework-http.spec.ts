import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AUTH_PROVIDER } from "../auth/auth-provider.interface";
import { PrismaService } from "../prisma/prisma.service";
import { HomeworkController } from "./homework.controller";
import { HomeworkService } from "./homework.service";

describe("Homework HTTP contract", () => {
  let app: INestApplication; let url: string;
  const upload = jest.fn().mockResolvedValue({ sessionId: "session-1", extractedQuestion: "2+2?", candidates: [], status: "AWAITING_TOPIC_CONFIRMATION", remaining: 7 });
  const status = jest.fn().mockResolvedValue({ addonActive: true, remaining: 7, monthlyLimit: 8, eligibleSubjects: [], available: true });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [HomeworkController], providers: [
      { provide: HomeworkService, useValue: { upload, status, listSessions: jest.fn().mockResolvedValue([]), getSession: jest.fn(), confirmTopic: jest.fn(), turn: jest.fn() } },
      { provide: AUTH_PROVIDER, useValue: { verifySessionToken: async () => ({ externalUserId: "clerk-student" }) } },
      { provide: PrismaService, useValue: { client: { user: { findUnique: async () => ({ id: "user-1", isActive: true, deletedAt: null }) } } } },
    ] }).compile();
    app = module.createNestApplication(); app.useLogger(false); await app.listen(0, "127.0.0.1"); url = await app.getUrl();
  });
  afterAll(async () => { await app.close(); });

  it("requires Clerk authentication for status and upload", async () => {
    expect((await fetch(`${url}/homework/status`)).status).toBe(401);
    expect((await fetch(`${url}/homework/sessions`, { method: "POST" })).status).toBe(401);
  });

  it("accepts one in-memory multipart photo and returns only extracted text", async () => {
    const form = new FormData(); form.append("subjectId", "subject-1");
    form.append("photo", new Blob([Buffer.from("temporary-image")], { type: "image/png" }), "homework.png");
    const response = await fetch(`${url}/homework/sessions`, { method: "POST", headers: { authorization: "Bearer fixture" }, body: form });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ extractedQuestion: "2+2?", status: "AWAITING_TOPIC_CONFIRMATION" });
    expect(upload).toHaveBeenCalledWith("user-1", "subject-1", expect.objectContaining({ mimetype: "image/png", buffer: expect.any(Buffer) }));
  });

  it("returns authenticated status from the server feature gate", async () => {
    const response = await fetch(`${url}/homework/status`, { headers: { authorization: "Bearer fixture" } });
    expect(await response.json()).toMatchObject({ addonActive: true, remaining: 7, monthlyLimit: 8 });
    expect(status).toHaveBeenCalledWith("user-1");
  });
});
