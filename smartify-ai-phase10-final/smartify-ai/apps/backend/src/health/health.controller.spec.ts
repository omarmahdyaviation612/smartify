import { ServiceUnavailableException } from "@nestjs/common";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  it("reports liveness without dependencies", () => {
    const controller = new HealthController({} as never);
    expect(controller.live()).toEqual({ status: "ok" });
  });

  it("reports readiness when PostgreSQL responds", async () => {
    const controller = new HealthController({ client: { $queryRaw: jest.fn().mockResolvedValue([{ "?column?": 1 }]) } } as never);
    await expect(controller.ready()).resolves.toEqual({ status: "ready", database: "up" });
  });

  it("fails readiness when PostgreSQL is unavailable", async () => {
    const controller = new HealthController({ client: { $queryRaw: jest.fn().mockRejectedValue(new Error("down")) } } as never);
    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
