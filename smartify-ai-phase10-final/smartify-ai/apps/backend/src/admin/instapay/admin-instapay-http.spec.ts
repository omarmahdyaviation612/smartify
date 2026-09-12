import { INestApplication, UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AdminInstapayController } from "./admin-instapay.controller";
import { AdminInstapayService } from "./admin-instapay.service";
import { AUTH_PROVIDER } from "../../auth/auth-provider.interface";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * Real HTTP, real Nest guards (ClerkAuthGuard + RolesGuard) — no DB, Clerk,
 * or payment provider calls. Locks in the InstaPay privacy/access review:
 * receipts and pending payments must never be reachable anonymously or by
 * a non-admin role, and list responses must never carry receipt bytes.
 */
describe("admin/instapay HTTP authorization and data exposure", () => {
  let app: INestApplication;
  let url: string;
  const listPending = jest.fn();
  const getReceipt = jest.fn();
  const confirm = jest.fn();
  const reject = jest.fn();

  async function get(path: string, token: string | null) {
    return fetch(`${url}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  }
  async function post(path: string, token: string | null) {
    return fetch(`${url}${path}`, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} });
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminInstapayController],
      providers: [
        { provide: AdminInstapayService, useValue: { listPending, listHistory: jest.fn(), getPendingCount: jest.fn(), getReceipt, confirm, reject } },
        { provide: AUTH_PROVIDER, useValue: { verifySessionToken: async (token: string) => {
          if (token === "invalid") throw new UnauthorizedException();
          return { externalUserId: token };
        } } },
        { provide: PrismaService, useValue: { client: { user: { findUnique: async ({ where }: { where: { clerkUserId: string } }) => ({
          id: `local-${where.clerkUserId}`, isActive: true, deletedAt: null,
          role: where.clerkUserId === "student" ? "STUDENT" : where.clerkUserId === "content-manager" ? "CONTENT_MANAGER" : "ADMIN",
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

  it.each([
    ["/admin/instapay/pending", null, 401],
    ["/admin/instapay/pending", "invalid", 401],
    ["/admin/instapay/pending", "student", 403],
    ["/admin/instapay/pending", "content-manager", 403],
    ["/admin/instapay/submissions/sub-1/receipt", null, 401],
    ["/admin/instapay/submissions/sub-1/receipt", "student", 403],
  ])("blocks GET %s for token %s with %d", async (path, token, expected) => {
    const res = await get(path as string, token as string | null);
    expect(res.status).toBe(expected);
    expect(listPending).not.toHaveBeenCalled();
    expect(getReceipt).not.toHaveBeenCalled();
  });

  it.each([
    ["/admin/instapay/submissions/sub-1/confirm", null, 401],
    ["/admin/instapay/submissions/sub-1/confirm", "student", 403],
    ["/admin/instapay/submissions/sub-1/reject", null, 401],
    ["/admin/instapay/submissions/sub-1/reject", "student", 403],
  ])("blocks POST %s for token %s with %d", async (path, token, expected) => {
    const res = await post(path as string, token as string | null);
    expect(res.status).toBe(expected);
    expect(confirm).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
  });

  it("allows an admin to list pending payments, and the response never carries receipt bytes", async () => {
    listPending.mockResolvedValue([
      { id: "sub-1", kind: "SUBSCRIPTION", referenceId: "SMAI-S-AAA", expectedAmountEGP: "500", submittedAmountEGP: "500", status: "PENDING_VERIFICATION" },
    ]);
    const res = await get("/admin/instapay/pending", "admin");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/receiptImage/i);
    expect(text).not.toMatch(/receiptMimeType/i);
    expect(listPending).toHaveBeenCalled();
  });

  it("allows an admin to fetch a receipt and streams the raw bytes with the correct content-type", async () => {
    getReceipt.mockResolvedValue({ receiptImage: Buffer.from([0xff, 0xd8, 0xff]), receiptMimeType: "image/jpeg" });
    const res = await get("/admin/instapay/submissions/sub-1/receipt", "admin");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toContain("no-store");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual([0xff, 0xd8, 0xff]);
    expect(getReceipt).toHaveBeenCalledWith("sub-1");
  });

  it("allows SUPER_ADMIN/ADMIN to confirm and reject", async () => {
    confirm.mockResolvedValue({ id: "sub-1", status: "VERIFIED" });
    reject.mockResolvedValue({ id: "sub-2", status: "REJECTED" });
    expect((await post("/admin/instapay/submissions/sub-1/confirm", "admin")).status).toBe(201);
    expect((await post("/admin/instapay/submissions/sub-2/reject", "admin")).status).toBe(201);
    expect(confirm).toHaveBeenCalledWith("sub-1", "local-admin");
    expect(reject).toHaveBeenCalledWith("sub-2", "local-admin", undefined);
  });
});
