import { BadRequestException } from "@nestjs/common";
import { AdminCurriculumController } from "./admin-curriculum.controller";

describe("AdminCurriculumController material validation", () => {
  const createMaterial = jest.fn();
  const controller = new AdminCurriculumController({ createMaterial } as never);

  it("rejects binary content disguised as text", () => {
    const file = { originalname: "bad.txt", mimetype: "text/plain", size: 3, buffer: Buffer.from([65, 0, 66]) };
    expect(() => controller.uploadMaterial(file, "topic")).toThrow(BadRequestException);
    expect(createMaterial).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", () => {
    const file = { originalname: "bad.json", mimetype: "application/json", size: 1, buffer: Buffer.from("{") };
    expect(() => controller.uploadMaterial(file, "topic")).toThrow("JSON material must contain valid JSON.");
  });

  it("accepts valid UTF-8 JSON", () => {
    const file = { originalname: "ok.json", mimetype: "application/json", size: 12, buffer: Buffer.from('{"name":"ع"}') };
    controller.uploadMaterial(file, "topic");
    expect(createMaterial).toHaveBeenCalledWith("topic", file);
  });
});
