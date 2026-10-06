import { NotFoundException } from "@nestjs/common";
import { AdminCurriculumService } from "./admin-curriculum.service";

describe("AdminCurriculumService.prepareNextSubjectGroundingChunk", () => {
  const unitGrounding = { prepareNextGroundingChunk: jest.fn() };

  function makeService(subject: any) {
    const prisma = { client: { subject: { findUnique: jest.fn().mockResolvedValue(subject) } } };
    const service = new AdminCurriculumService(prisma as any, {} as any, {} as any, {} as any, {} as any, unitGrounding as any);
    return { service, prisma };
  }

  beforeEach(() => unitGrounding.prepareNextGroundingChunk.mockReset());

  it("grounds at most one bounded chunk for the first ungrounded Unit and reports subject progress", async () => {
    const subject = {
      id: "subject-1",
      units: [
        { id: "unit-ready", nameEn: "Ready", order: 1, groundingNotesJson: { concepts: [] } },
        { id: "unit-next", nameEn: "Next", order: 2, groundingNotesJson: null },
      ],
    };
    unitGrounding.prepareNextGroundingChunk.mockResolvedValue({ status: "PREPARING", retryAfterMs: 1200 });
    const { service } = makeService(subject);

    await expect(service.prepareNextSubjectGroundingChunk("subject-1")).resolves.toEqual({
      subjectId: "subject-1",
      status: "PREPARING",
      unitId: "unit-next",
      unitNameEn: "Next",
      retryAfterMs: 1200,
      groundedUnits: 1,
      totalUnits: 2,
    });
    expect(unitGrounding.prepareNextGroundingChunk).toHaveBeenCalledTimes(1);
    expect(unitGrounding.prepareNextGroundingChunk).toHaveBeenCalledWith("unit-next", expect.any(String));
  });

  it("does not call grounding when every Unit is already grounded", async () => {
    const { service } = makeService({ id: "subject-1", units: [{ id: "unit-1", groundingNotesJson: { concepts: [] } }] });
    await expect(service.prepareNextSubjectGroundingChunk("subject-1")).resolves.toMatchObject({ status: "READY", groundedUnits: 1, totalUnits: 1 });
    expect(unitGrounding.prepareNextGroundingChunk).not.toHaveBeenCalled();
  });

  it("continues with the next Unit instead of reporting the whole Subject complete", async () => {
    const { service } = makeService({
      id: "subject-1",
      units: [
        { id: "unit-next", nameEn: "Next", order: 1, groundingNotesJson: null },
        { id: "unit-later", nameEn: "Later", order: 2, groundingNotesJson: null },
      ],
    });
    unitGrounding.prepareNextGroundingChunk.mockResolvedValue({ status: "READY" });

    await expect(service.prepareNextSubjectGroundingChunk("subject-1")).resolves.toMatchObject({
      status: "UNIT_READY",
      unitId: "unit-next",
      groundedUnits: 1,
      totalUnits: 2,
    });
  });

  it("rejects a missing Subject", async () => {
    const { service } = makeService(null);
    await expect(service.prepareNextSubjectGroundingChunk("missing")).rejects.toBeInstanceOf(NotFoundException);
    expect(unitGrounding.prepareNextGroundingChunk).not.toHaveBeenCalled();
  });

  it("reports Subjects without Units without calling the grounding provider", async () => {
    const { service } = makeService({ id: "subject-1", units: [] });
    await expect(service.prepareNextSubjectGroundingChunk("subject-1")).resolves.toEqual({
      subjectId: "subject-1",
      status: "NO_UNITS",
      groundedUnits: 0,
      totalUnits: 0,
    });
    expect(unitGrounding.prepareNextGroundingChunk).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "CONFIGURATION_ERROR", reason: "source_or_page_range_invalid" }, "CONFIGURATION_ERROR"],
    [{ status: "PROVIDER_OUTAGE", reason: "provider_quota_exhausted" }, "PROVIDER_OUTAGE"],
    [{ status: "RETRYABLE_FAILURE", reason: "provider_rate_limited", retryAfterMs: 5000, nextEligibleAt: new Date() }, "RETRYABLE_FAILURE"],
  ] as const)("preserves blocked/retry state %s", async (outcome, expectedStatus) => {
    const { service } = makeService({ id: "subject-1", units: [{ id: "unit-1", nameEn: "Unit 1", order: 1, groundingNotesJson: null }] });
    unitGrounding.prepareNextGroundingChunk.mockResolvedValue(outcome);

    await expect(service.prepareNextSubjectGroundingChunk("subject-1")).resolves.toMatchObject({
      status: expectedStatus,
      unitId: "unit-1",
      groundedUnits: 0,
      totalUnits: 1,
      reason: "reason" in outcome ? outcome.reason : undefined,
    });
  });
});
