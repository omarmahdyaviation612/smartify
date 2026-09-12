import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { AUTH_PROVIDER } from "../auth/auth-provider.interface";
import { PrismaService } from "../prisma/prisma.service";

describe("billing HTTP contract", () => {
  let app: INestApplication;
  let url: string;
  const getPaymentStatus = jest.fn().mockResolvedValue({ status: "unverified" });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        { provide: BillingService, useValue: {
          getCurrentSubscription: async () => null,
          getAvailablePlans: async () => [{ id: "grade-1-5", monthlyPriceEGP: "500" }],
          getPaymentStatus,
        } },
        { provide: AUTH_PROVIDER, useValue: { verifySessionToken: async () => ({ externalUserId: "own-clerk-user" }) } },
        { provide: PrismaService, useValue: { client: { user: { findUnique: async () => ({ id: "own-user", isActive: true, deletedAt: null }) } } } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    await app.listen(0, "127.0.0.1");
    url = await app.getUrl();
  });
  afterAll(() => app.close());
  it("returns JSON null for no subscription so loading plans does not reject", async () => {
    const response = await fetch(`${url}/billing/subscription`, { headers: { authorization: "Bearer fixture" } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("null");
  });
  it("requires authentication for payment verification", async () => {
    expect((await fetch(`${url}/billing/payment-status`)).status).toBe(401);
  });
  it("ignores forged success and user identifiers and verifies only the authenticated user", async () => {
    const response = await fetch(`${url}/billing/payment-status?status=paid&userId=other&session_id=other`, {
      headers: { authorization: "Bearer fixture" },
    });
    expect(await response.json()).toEqual({ status: "unverified" });
    expect(getPaymentStatus).toHaveBeenLastCalledWith("own-user");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
