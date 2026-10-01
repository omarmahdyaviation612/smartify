import { remapTopicEvidence, TopicSourceEvidenceService } from "./topic-source-evidence.service";

describe("topic source evidence provenance", () => {
  it("maps request-local ordinals to physical pages", () => expect(remapTopicEvidence([{ type: "concept", label: "x", sourceImageIndexes: [1, 3] }], 10, 12)[0].sourcePages).toEqual([10, 12]));
  it("rejects invalid ordinals and missing provenance", () => {
    expect(() => remapTopicEvidence([{ type: "concept", label: "x", sourceImageIndexes: [0] }], 1, 2)).toThrow();
    expect(() => remapTopicEvidence([{ type: "concept", label: "x" }], 1, 2)).toThrow();
  });
});

describe("TopicSourceEvidenceService shared extraction path", () => {
  const identity = { topicId: "t1", unitId: "u1", sourceFingerprint: "fp", sourcePageStart: 10, sourcePageEnd: 11, promptVersion: "p1", extractorModel: "m1" };
  function harness(content: unknown) {
    const sourceExtraction = { renderSourcePages: jest.fn().mockResolvedValue({ imageDataUrls: [{ index: 1, dataUrl: "data:image/png;base64,YQ==" }, { index: 2, dataUrl: "data:image/png;base64,Yg==" }], start: 10, end: 11 }) } as any;
    const vision = { createAccountingContext: jest.fn().mockResolvedValue({ id: "a" }), execute: jest.fn().mockResolvedValue({ result: { content } }), finalizeSuccess: jest.fn().mockResolvedValue(undefined), finalizeFailure: jest.fn().mockResolvedValue(undefined) } as any;
    const store = { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({ id: "e1", ...identity, status: "PREPARING" }), update: jest.fn(({ data }: any) => Promise.resolve({ id: "e1", ...identity, ...data })) };
    const service = new TopicSourceEvidenceService({ client: { topicSourceEvidence: store } } as any, sourceExtraction, vision);
    return { service, sourceExtraction, vision, store };
  }

  const expectedSelector = { topicId: "t1", sourceFingerprint: "fp", sourcePageStart: 10, sourcePageEnd: 11, promptVersion: "p1", extractorModel: "m1" };
  const selectorKey = "topicId_sourceFingerprint_sourcePageStart_sourcePageEnd_promptVersion_extractorModel";
  it("getReusable passes exactly the six generated selector fields", async () => {
    const h = harness(null);
    await h.service.getReusable(identity);
    expect(h.store.findUnique).toHaveBeenCalledWith({ where: { [selectorKey]: expectedSelector } });
  });
  it("prepare restricts lookup and upsert selectors while retaining unitId in create data", async () => {
    const h = harness(null);
    await h.service.prepare(identity);
    expect(h.store.findUnique).toHaveBeenCalledWith({ where: { [selectorKey]: expectedSelector } });
    expect(h.store.upsert).toHaveBeenCalledWith({ where: { [selectorKey]: expectedSelector }, create: { ...identity, status: "PREPARING" }, update: { status: "PREPARING", failureCode: null, failureReason: null } });
  });
  it("does not leak arbitrary identity properties into any compound selector", async () => {
    const h = harness(null);
    const extended = { ...identity, unexpectedProperty: "must-not-leak" };
    await h.service.getReusable(extended);
    await h.service.prepare(extended);
    for (const call of h.store.findUnique.mock.calls as any[]) expect(call[0].where[selectorKey]).toStrictEqual(expectedSelector);
    for (const call of h.store.upsert.mock.calls as any[]) expect(call[0].where[selectorKey]).toStrictEqual(expectedSelector);
  });
  it.each(["READY", "NOT_FOUND"])("reuses %s without writes or extraction", async (status) => {
    const h = harness(null);
    const row = { id: "e1", ...identity, status };
    h.store.findUnique.mockResolvedValue(row as never);
    expect(await h.service.prepare(identity)).toBe(row);
    expect(await h.service.prepareTopicEvidence(identity, { sourceKey: "book.pdf", curriculumCode: "C", gradeLevel: 5, topicName: "Topic" })).toBe(row);
    expect(h.store.upsert).not.toHaveBeenCalled();
    expect(h.store.update).not.toHaveBeenCalled();
    expect(h.sourceExtraction.renderSourcePages).not.toHaveBeenCalled();
    expect(h.vision.execute).not.toHaveBeenCalled();
  });
  it("uses only PrismaService.client for lookup, PREPARING and every terminal state", async () => {
    const h = harness(null);
    await expect(h.service.getReusable(identity)).resolves.toBeNull();
    await expect(h.service.prepare(identity)).resolves.toMatchObject({ status: "PREPARING" });
    expect(h.store.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { ...identity, status: "PREPARING" } }));
    for (const status of ["READY", "NOT_FOUND", "FAILED"] as const) {
      await expect(h.service.complete("e1", status)).resolves.toMatchObject({ status });
      expect(h.store.update).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "e1" }, data: expect.objectContaining({ status }) }));
    }
  });
  it("passes the materialized payload to shared Vision once and persists READY with physical pages", async () => {
    const h = harness(JSON.stringify({ supported: true, items: [{ type: "concept", label: "Verified", sourceImageIndexes: [2] }] }));
    const result = await h.service.prepareTopicEvidence(identity, { sourceKey: "book.pdf", curriculumCode: "C", gradeLevel: 5, topicName: "Topic" });
    expect(result.status).toBe("READY");
    expect((result.evidenceJson as any[])[0]).toMatchObject({ label: "Verified", sourcePages: [11] });
    expect(h.sourceExtraction.renderSourcePages).toHaveBeenCalledTimes(1);
    expect(h.vision.execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.vision.execute.mock.calls[0][0].messages)).toContain("data:image/png;base64,YQ==");
    expect(JSON.stringify(h.vision.execute.mock.calls[0][0])).not.toContain("imagePaths");
    expect(h.vision.finalizeSuccess).toHaveBeenCalledTimes(1);
  });

  it("persists supported:false as NOT_FOUND", async () => {
    const h = harness(JSON.stringify({ supported: false }));
    expect((await h.service.prepareTopicEvidence(identity, { sourceKey: "book.pdf", curriculumCode: "C", gradeLevel: 5, topicName: "Topic" })).status).toBe("NOT_FOUND");
    expect(h.vision.execute).toHaveBeenCalledTimes(1);
  });

  it("persists a technical failure as FAILED and finalizes once", async () => {
    const h = harness("not-json");
    expect((await h.service.prepareTopicEvidence(identity, { sourceKey: "book.pdf", curriculumCode: "C", gradeLevel: 5, topicName: "Topic" })).status).toBe("FAILED");
    expect(h.vision.execute).toHaveBeenCalledTimes(1);
    expect(h.vision.finalizeFailure).toHaveBeenCalledTimes(1);
  });
});
