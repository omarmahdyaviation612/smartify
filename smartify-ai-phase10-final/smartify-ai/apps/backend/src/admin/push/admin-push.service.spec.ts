const mockEnv: Record<string, string | undefined> = { WEB_PUSH_PUBLIC_KEY: "pub", WEB_PUSH_PRIVATE_KEY: "priv" };
jest.mock("@smartify/config", () => ({ loadBackendEnv: () => mockEnv }));
const sendNotification = jest.fn();
jest.mock("web-push", () => ({ sendNotification: (...args: unknown[]) => sendNotification(...args) }));

import { AdminPushService } from "./admin-push.service";

const sub = (id: string) => ({ id, endpoint: `https://push.example/${id}`, p256dh: "p".repeat(20), auth: "a".repeat(10) });
const payload = { title: "t", body: "b", url: "https://smartify-ai.com/ar/admin/instapay", tag: "x" };

function makePrisma(subs = [sub("s1"), sub("s2")]) {
  return {
    client: {
      adminPushSubscription: {
        findMany: jest.fn().mockResolvedValue(subs),
        count: jest.fn().mockResolvedValue(subs.length),
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
    },
  } as any;
}

describe("AdminPushService", () => {
  beforeEach(() => {
    sendNotification.mockReset();
    mockEnv.WEB_PUSH_PUBLIC_KEY = "pub";
    mockEnv.WEB_PUSH_PRIVATE_KEY = "priv";
  });

  it("sends to every active admin device with VAPID details and the JSON payload", async () => {
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const prisma = makePrisma();
    const result = await new AdminPushService(prisma).sendToAdmins(payload);
    expect(result).toEqual({ sent: 2, total: 2 });
    expect(prisma.client.adminPushSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { user: { role: { in: ["SUPER_ADMIN", "ADMIN"] }, isActive: true, deletedAt: null } },
    }));
    const [target, body, options] = sendNotification.mock.calls[0];
    expect(target).toEqual({ endpoint: "https://push.example/s1", keys: { p256dh: "p".repeat(20), auth: "a".repeat(10) } });
    expect(JSON.parse(body)).toEqual(payload);
    expect(options.vapidDetails).toMatchObject({ publicKey: "pub", privateKey: "priv", subject: expect.stringMatching(/^mailto:/) });
  });

  it("removes subscriptions the push service reports as gone and never throws", async () => {
    sendNotification.mockImplementation(async (target: any) => {
      if (target.endpoint.endsWith("s1")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      throw Object.assign(new Error("boom"), { statusCode: 500 });
    });
    const prisma = makePrisma();
    await expect(new AdminPushService(prisma).sendToAdmins(payload)).resolves.toEqual({ sent: 0, total: 2 });
    expect(prisma.client.adminPushSubscription.delete).toHaveBeenCalledTimes(1);
    expect(prisma.client.adminPushSubscription.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
  });

  it("is a no-op without VAPID keys and reports itself as disabled", async () => {
    delete mockEnv.WEB_PUSH_PRIVATE_KEY;
    const prisma = makePrisma();
    const service = new AdminPushService(prisma);
    expect(await service.sendToAdmins(payload)).toEqual({ sent: 0, total: 2 });
    expect(sendNotification).not.toHaveBeenCalled();
    expect(await service.config("u1")).toEqual({ enabled: false, publicKey: null, devices: 2 });
  });

  it("stores a device per endpoint for the current admin", async () => {
    const prisma = makePrisma([]);
    await new AdminPushService(prisma).subscribe("u1", { endpoint: "https://push.example/new", keys: { p256dh: "p".repeat(20), auth: "a".repeat(10) } }, "UA");
    expect(prisma.client.adminPushSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { endpoint: "https://push.example/new" },
      create: expect.objectContaining({ userId: "u1", userAgent: "UA" }),
    }));
  });
});
