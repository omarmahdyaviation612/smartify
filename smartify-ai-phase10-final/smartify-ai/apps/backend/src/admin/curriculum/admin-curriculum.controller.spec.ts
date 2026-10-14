import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AdminCurriculumController } from "./admin-curriculum.controller";

describe("AdminCurriculumController material validation", () => {
  const service = {
    createMaterial: jest.fn(),
    uploadSubjectTextbook: jest.fn(),
  };
  const controller = new AdminCurriculumController(service as never);

  beforeEach(() => jest.clearAllMocks());

  it("rejects binary content disguised as text", () => {
    const file = { originalname: "bad.txt", mimetype: "text/plain", size: 3, buffer: Buffer.from([65, 0, 66]) };
    expect(() => controller.uploadMaterial(file, "topic")).toThrow(BadRequestException);
    expect(service.createMaterial).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", () => {
    const file = { originalname: "bad.json", mimetype: "application/json", size: 1, buffer: Buffer.from("{") };
    expect(() => controller.uploadMaterial(file, "topic")).toThrow("JSON material must contain valid JSON.");
  });

  it("accepts valid UTF-8 JSON", () => {
    const file = { originalname: "ok.json", mimetype: "application/json", size: 12, buffer: Buffer.from('{"name":"ع"}') };
    controller.uploadMaterial(file, "topic");
    expect(service.createMaterial).toHaveBeenCalledWith("topic", file);
  });

  it("uploads a subject PDF through the guarded textbook source workflow with the actual subjectId", async () => {
    const file = { originalname: "book.pdf", mimetype: "application/pdf", size: 10, buffer: Buffer.from("%PDF-test") };
    const result = { subjectId: "subject-42", subjectNameEn: "Science", sourceFile: "source/science.pdf" };
    service.uploadSubjectTextbook.mockResolvedValue(result);

    await expect(controller.uploadSubjectMaterial(file, "subject-42")).resolves.toBe(result);

    expect(service.uploadSubjectTextbook).toHaveBeenCalledWith("subject-42", file);
  });

  it("rejects a PDF on the topic-material route instead of treating the file as a subject ID", () => {
    const file = { originalname: "book.pdf", mimetype: "application/pdf", size: 10, buffer: Buffer.from("%PDF-test") };

    expect(() => controller.uploadMaterial(file, "topic-42")).toThrow(BadRequestException);
    expect(service.createMaterial).not.toHaveBeenCalled();
    expect(service.uploadSubjectTextbook).not.toHaveBeenCalled();
  });

  it("rejects missing subject IDs and files before calling the upload service", () => {
    const file = { originalname: "book.pdf", mimetype: "application/pdf", size: 10, buffer: Buffer.from("%PDF-test") };

    expect(() => controller.uploadSubjectMaterial(file, "")).toThrow(BadRequestException);
    expect(() => controller.uploadSubjectMaterial(undefined as never, "subject-42")).toThrow(BadRequestException);
    expect(service.uploadSubjectTextbook).not.toHaveBeenCalled();
  });

  it("rejects non-PDF and oversized subject material using the existing limits", () => {
    const text = { originalname: "book.txt", mimetype: "text/plain", size: 4, buffer: Buffer.from("text") };
    const oversized = { originalname: "large.pdf", mimetype: "application/pdf", size: 25 * 1024 * 1024 + 1, buffer: Buffer.from("%PDF-test") };

    expect(() => controller.uploadSubjectMaterial(text, "subject-42")).toThrow(BadRequestException);
    expect(() => controller.uploadSubjectMaterial(oversized, "subject-42")).toThrow(BadRequestException);
    expect(service.uploadSubjectTextbook).not.toHaveBeenCalled();
  });

  it("preserves the source workflow's not-found rejection for an unknown subject ID", async () => {
    const file = { originalname: "book.pdf", mimetype: "application/pdf", size: 10, buffer: Buffer.from("%PDF-test") };
    service.uploadSubjectTextbook.mockRejectedValue(new NotFoundException("Subject missing not found."));

    await expect(controller.uploadSubjectMaterial(file, "missing")).rejects.toThrow(NotFoundException);
    expect(service.uploadSubjectTextbook).toHaveBeenCalledWith("missing", file);
  });
});
