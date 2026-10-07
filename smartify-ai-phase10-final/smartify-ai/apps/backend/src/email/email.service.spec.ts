const mockEnv = { RESEND_API_KEY: undefined, RESEND_FROM_EMAIL: undefined };
jest.mock("@smartify/config", () => ({ loadBackendEnv: () => mockEnv }));

import { Logger } from "@nestjs/common";
import { EmailService } from "./email.service";

describe("EmailService privacy", () => {
  it("does not log recipient, result, or message content when email is unconfigured", async () => {
    const output: string[] = [];
    const log = jest.spyOn(Logger.prototype, "log").mockImplementation((message) => output.push(String(message)));
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation((message) => output.push(String(message)));
    try {
      const service = new EmailService();
      await service.send({
        to: "parent-private@example.test",
        subject: "Student Name scored 73%",
        html: "Subject: Science; score 73%; answer content is private.",
      });
      expect(output.join(" ")).not.toMatch(/parent-private|Student Name|73%|Science|answer content/i);
    } finally {
      log.mockRestore();
      warn.mockRestore();
    }
  });
});
