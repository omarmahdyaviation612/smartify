const mockEnv: Record<string, string | undefined> = { FRONTEND_URL: "https://smartify-ai.com/" };
jest.mock("@smartify/config", () => ({ loadBackendEnv: () => mockEnv }));

import { buildInstapayAlertEmail, InstapayAdminAlertService, parseAlertEmails } from "./instapay-admin-alert.service";

const base = {
  submissionId: "sub-1", kind: "SUBSCRIPTION" as const, referenceId: "SMAI-S-ABC",
  expectedAmountEGP: 400, submittedAmountEGP: 400, studentName: "Omar <b>", senderName: null,
};

describe("InstaPay admin alert", () => {
  it("parses ADMIN_ALERT_EMAILS", () => {
    expect(parseAlertEmails(" A@x.com, b@y.com;a@x.com  bad ")).toEqual(["a@x.com", "b@y.com"]);
    expect(parseAlertEmails(undefined)).toEqual([]);
  });

  it("email names the amount, student and reference, escapes HTML and links to the review page", () => {
    const { subject, html } = buildInstapayAlertEmail(base, "https://smartify-ai.com/ar/admin/instapay");
    expect(subject).toContain("400");
    expect(subject).not.toContain("⚠️");
    expect(html).toContain("SMAI-S-ABC");
    expect(html).toContain("Omar &lt;b&gt;");
    expect(html).toContain('href="https://smartify-ai.com/ar/admin/instapay"');
  });

  it("flags an amount that differs from the expected one", () => {
    expect(buildInstapayAlertEmail({ ...base, submittedAmountEGP: 300 }, "u").subject).toContain("⚠️");
  });

  it("falls back to active admins and never throws when sending fails", async () => {
    const sent: string[] = [];
    const prisma = { client: { user: { findMany: jest.fn().mockResolvedValue([{ email: "Admin@x.com" }, { email: "admin@x.com" }, { email: "s@x.com" }]) } } };
    const email = { send: jest.fn(async ({ to }) => { sent.push(to); if (to === "s@x.com") throw new Error("down"); return { sent: true }; }) };
    const svc = new InstapayAdminAlertService(prisma as any, email as any);
    await expect(svc.notifyNewSubmission(base)).resolves.toBeUndefined();
    expect(prisma.client.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ role: { in: ["SUPER_ADMIN", "ADMIN"] } }) }));
    expect(sent.sort()).toEqual(["admin@x.com", "s@x.com"]);
    expect(email.send.mock.calls[0][0].html).toContain('href="https://smartify-ai.com/ar/admin/instapay"');
  });

  it("uses ADMIN_ALERT_EMAILS instead of the admin users when set", async () => {
    mockEnv.ADMIN_ALERT_EMAILS = "owner@gmail.com";
    const prisma = { client: { user: { findMany: jest.fn() } } };
    const email = { send: jest.fn(async () => ({ sent: true })) };
    await new InstapayAdminAlertService(prisma as any, email as any).notifyNewSubmission(base);
    expect(prisma.client.user.findMany).not.toHaveBeenCalled();
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to: "owner@gmail.com" }));
    delete mockEnv.ADMIN_ALERT_EMAILS;
  });
});
