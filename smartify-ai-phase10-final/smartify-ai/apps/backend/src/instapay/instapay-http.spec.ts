import { INestApplication, UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { InstapayController } from "./instapay.controller";
import { InstapayService } from "./instapay.service";
import { AUTH_PROVIDER } from "../auth/auth-provider.interface";
import { PrismaService } from "../prisma/prisma.service";

/** Real HTTP + real ClerkAuthGuard — proves InstaPay's student-facing routes require authentication. */
describe("instapay HTTP authorization", () => {
  let app: INestApplication;
  let url: string;
  const listMine = jest.fn();
  const submitReceipt = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [InstapayController],
      providers: [
        { provide: InstapayService, useValue: { listMine, submitReceipt, isConfigured: () => true, initiateSubscription: jest.fn(), initiateQuestionPack: jest.fn() } },
        { provide: AUTH_PROVIDER, useValue: { verifySessionToken: async (token: string) => {
          if (token === "invalid") throw new UnauthorizedException();
          return { externalUserId: token };
        } } },
        { provide: PrismaService, useValue: { client: { user: { findUnique: async ({ where }: { where: { clerkUserId: string } }) => ({
          id: `local-${where.clerkUserId}`, isActive: true, deletedAt: null, role: "STUDENT",
        }) } } } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    await app.listen(0, "127.0.0.1");
    url = await app.getUrl();
  });
  afterAll(async () => app?.close());
  beforeEach(() => jest.clearAllMocks());

  it("rejects anonymous access to /instapay/submissions/mine", async () => {
    const res = await fetch(`${url}/instapay/submissions/mine`);
    expect(res.status).toBe(401);
    expect(listMine).not.toHaveBeenCalled();
  });

  it("rejects an invalid token", async () => {
    const res = await fetch(`${url}/instapay/submissions/mine`, { headers: { authorization: "Bearer invalid" } });
    expect(res.status).toBe(401);
  });

  it("scopes /instapay/submissions/mine to the authenticated user's own local id", async () => {
    listMine.mockResolvedValue([{ id: "sub-1", referenceId: "SMAI-S-AAA" }]);
    const res = await fetch(`${url}/instapay/submissions/mine`, { headers: { authorization: "Bearer own-user" } });
    expect(res.status).toBe(200);
    expect(listMine).toHaveBeenCalledWith("local-own-user");
  });

  it("rejects anonymous receipt submission", async () => {
    const res = await fetch(`${url}/instapay/submissions`, { method: "POST" });
    expect(res.status).toBe(401);
    expect(submitReceipt).not.toHaveBeenCalled();
  });
});
