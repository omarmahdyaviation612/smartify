import { AdminCurriculumService } from "./admin-curriculum.service";

/**
 * Read-only curriculum status dashboard (2026-09-20) — the smallest step
 * from the curriculum/admin audit. Covers: hierarchy shape, textbook
 * mapped/unmapped, grounded/ungrounded Unit, Topic status derivation
 * (including the HISTORICAL_GENERATED case the audit specifically flagged),
 * summary counts, and that groundingNotesJson/teachingStepsJson are never
 * leaked into the response.
 */
describe("AdminCurriculumService.getCurriculumStatus", () => {
  function makeService(findManyImpl: (...args: any[]) => any) {
    const prisma = {
      client: {
        curriculum: { findMany: jest.fn(findManyImpl) },
        gradeSubject: { findMany: jest.fn(async () => []) },
      },
    };
    return { service: new AdminCurriculumService(prisma as any, {} as any, {} as any, {} as any, {} as any), prisma };
  }

  function fakeCurricula() {
    return [
      {
        id: "c1",
        nameEn: "British International Curriculum",
        nameAr: "المنهج البريطاني الدولي",
        code: "BRITISH_INTL",
        isActive: true,
        grades: [
          {
            id: "g1",
            nameEn: "Year 5",
            nameAr: "السنة الخامسة",
            level: 5,
            isActive: true,
            // Availability is an OFFERING now, so the fixture carries the
            // GradeSubject shape the query actually returns.
            offeredSubjects: [
              {
                isActive: true,
                subject: {
                  id: "s1",
                  gradeId: "g1",
                  nameEn: "Science",
                  nameAr: "العلوم",
                  isActive: true,
                  sourceFile: "british-intl/grade-5/science/science-y5.pdf",
                  units: [
                    {
                      id: "u1",
                      nameEn: "Plant parts",
                      nameAr: "أجزاء النبات",
                      order: 1,
                      sourcePageStart: 8,
                      sourcePageEnd: 17,
                      sourceFileOverride: null,
                      groundingNotesJson: { concepts: [{ name: "Plant Parts" }] },
                      groundingGeneratedAt: new Date("2026-09-19T18:32:45.307Z"),
                      groundingVersion: 1,
                      groundingModel: "gpt-4o-mini",
                      groundingPromptVersion: "grounding-extraction-v1",
                      topics: [
                        {
                          id: "t1",
                          nameEn: "Plant parts",
                          nameAr: "أجزاء النبات",
                          order: 1,
                          teachingStepsJson: [{ id: "s1", type: "INTRO" }],
                          generationSource: "TEXTBOOK_GROUNDED",
                          groundingVersionUsed: 1,
                          generationPromptVersion: "auto-lesson-v1",
                          contentGeneratedAt: new Date("2026-09-19T18:50:24.980Z"),
                        },
                        {
                          // Historical: published via the OLD pre-2026-09-19
                          // publish() pipeline — teachingStepsJson set, but
                          // generationSource was never written by that path.
                          id: "t2",
                          nameEn: "Letter Alef",
                          nameAr: "حرف الألف",
                          order: 2,
                          teachingStepsJson: [{ id: "s1", type: "INTRO" }],
                          generationSource: null,
                          groundingVersionUsed: null,
                          generationPromptVersion: null,
                          contentGeneratedAt: null,
                        },
                      {
                        id: "t3",
                        nameEn: "Untouched topic",
                        nameAr: "موضوع",
                        order: 3,
                        teachingStepsJson: null,
                        generationSource: null,
                        groundingVersionUsed: null,
                        generationPromptVersion: null,
                        contentGeneratedAt: null,
                      },
                    ],
                  },
                  {
                    id: "u2",
                    nameEn: "Adaptation",
                    nameAr: "التكيف",
                    order: 2,
                    sourcePageStart: 32,
                    sourcePageEnd: 43,
                    sourceFileOverride: "british-intl/grade-5/science/extras/field-guide.pdf",
                    groundingNotesJson: null,
                    groundingGeneratedAt: null,
                    groundingVersion: null,
                    groundingModel: null,
                    groundingPromptVersion: null,
                    topics: [
                      {
                        id: "t4",
                        nameEn: "Adaptation",
                        nameAr: "التكيف",
                        order: 1,
                        teachingStepsJson: null,
                        generationSource: null,
                        groundingVersionUsed: null,
                        generationPromptVersion: null,
                        contentGeneratedAt: null,
                      },
                    ],
                  },
                ],
              },
            },
              {
                isActive: true,
                subject: {
                  id: "s2",
                  gradeId: "g1",
                  nameEn: "Mathematics",
                  nameAr: "الرياضيات",
                  isActive: true,
                  sourceFile: null, // no textbook mapped
                  units: [],
                },
              },
            ],
          },
        ],
      },
    ];
  }

  it("returns the full Curriculum->Grade->Subject->Unit->Topic hierarchy from a single Prisma call", async () => {
    const { service, prisma } = makeService(fakeCurricula);
    const result = await service.getCurriculumStatus();

    expect(prisma.client.curriculum.findMany).toHaveBeenCalledTimes(1);
    expect(result.curricula).toHaveLength(1);
    expect(result.curricula[0].grades[0].subjects[0].units).toHaveLength(2);
    expect(result.curricula[0].grades[0].subjects[0].units[0].topics).toHaveLength(3);
  });

  it("marks a Subject with sourceFile as textbookMapped and exposes the stored object key/reference", async () => {
    const { service } = makeService(fakeCurricula);
    const result = await service.getCurriculumStatus();

    const science = result.curricula[0].grades[0].subjects[0];
    expect(science.textbookMapped).toBe(true);
    expect(science.sourceFile).toBe("british-intl/grade-5/science/science-y5.pdf");

    const math = result.curricula[0].grades[0].subjects[1];
    expect(math.textbookMapped).toBe(false);
    expect(math.sourceFile).toBeNull();
  });

  it("marks a Unit with groundingNotesJson as grounded, and one without as ungrounded", async () => {
    const { service } = makeService(fakeCurricula);
    const result = await service.getCurriculumStatus();

    const units = result.curricula[0].grades[0].subjects[0].units;
    expect(units[0].grounded).toBe(true);
    expect(units[0].groundingModel).toBe("gpt-4o-mini");
    expect(units[1].grounded).toBe(false);
    expect(units[1].groundingModel).toBeNull();
  });

  it("English Extra Book / Story support V1: marks a Unit with sourceFileOverride as usesExtraSource, a normal Unit as not, and never leaks the raw override key", async () => {
    const { service } = makeService(fakeCurricula);
    const result = await service.getCurriculumStatus();

    const units = result.curricula[0].grades[0].subjects[0].units;
    expect(units[0].usesExtraSource).toBe(false); // Plant parts — no override
    expect(units[1].usesExtraSource).toBe(true); // Adaptation — has sourceFileOverride
    expect(JSON.stringify(result)).not.toContain("field-guide.pdf");
  });

  it("derives correct Topic display status for TEXTBOOK_GROUNDED, HISTORICAL_GENERATED, and NEVER_GENERATED", async () => {
    const { service } = makeService(fakeCurricula);
    const result = await service.getCurriculumStatus();

    const topics = result.curricula[0].grades[0].subjects[0].units[0].topics;
    expect(topics[0].status).toBe("TEXTBOOK_GROUNDED");
    expect(topics[1].status).toBe("HISTORICAL_GENERATED"); // teachingStepsJson set, generationSource null
    expect(topics[1].status).not.toBe("NEVER_GENERATED");
    expect(topics[2].status).toBe("NEVER_GENERATED");
  });

  it("computes summary counts from the same returned data", async () => {
    const { service } = makeService(fakeCurricula);
    const result = await service.getCurriculumStatus();

    expect(result.summary).toEqual({
      subjects: 2, // Science + Mathematics
      units: 2, // Plant parts + Adaptation
      groundedUnits: 1, // Plant parts only
      topics: 4, // 3 under Plant parts + 1 under Adaptation
      generatedTopics: 2, // t1 (grounded) + t2 (historical)
      textbookGroundedTopics: 1, // t1 only
    });
  });

  it("never includes groundingNotesJson or the full teachingStepsJson in the response — metadata only", async () => {
    const { service } = makeService(fakeCurricula);
    const result = await service.getCurriculumStatus();
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("groundingNotesJson");
    expect(serialized).not.toContain("teachingStepsJson");
    // The boolean derived from it is fine, and expected, to be present:
    expect(result.curricula[0].grades[0].subjects[0].units[0].topics[0].hasTeachingSteps).toBe(true);
  });

  it("getCurriculumStatus flags a subject whose content home is a different grade", async () => {
    const shared = { id: "subject-arabic-eg5", nameEn: "Arabic", nameAr: "اللغة العربية", gradeId: "grade-eg-5", isActive: true, sourceFile: null, priceEGP: null, units: [] };

    const { service } = makeService(() => [
      {
        id: "c-uk", code: "BRITISH_INTL", nameEn: "British", nameAr: "بريطاني", isActive: true,
        grades: [{
          id: "grade-uk-6", nameEn: "Year 6", nameAr: "السنة ٦", level: 6, isActive: true,
          offeredSubjects: [{ isActive: true, subject: shared }],
        }],
      },
    ]);

    const status = await service.getCurriculumStatus();
    const subject = status.curricula[0].grades[0].subjects[0];

    expect(subject).toMatchObject({ id: shared.id, shared: true });
    expect(status.curricula[0].grades[0]).not.toHaveProperty("offeredSubjects");
  });

  it("does not flag a subject whose content home IS the grade as shared", async () => {
    const local = { id: "subject-science", nameEn: "Science", nameAr: "العلوم", gradeId: "grade-uk-6", isActive: true, sourceFile: null, priceEGP: null, units: [] };

    const { service } = makeService(() => [
      {
        id: "c-uk", code: "BRITISH_INTL", nameEn: "British", nameAr: "بريطاني", isActive: true,
        grades: [{
          id: "grade-uk-6", nameEn: "Year 6", nameAr: "السنة ٦", level: 6, isActive: true,
          offeredSubjects: [{ isActive: true, subject: local }],
        }],
      },
    ]);

    const status = await service.getCurriculumStatus();

    expect(status.curricula[0].grades[0].subjects[0]).toMatchObject({ id: local.id, shared: false });
  });
});

describe("AdminCurriculumService.listSubjects", () => {
  const SHARED = { id: "subject-arabic-eg5", nameEn: "Arabic", nameAr: "اللغة العربية", gradeId: "grade-eg-5", isActive: true };

  it("returns the grade's offerings, not only its own subjects", async () => {
    const gradeSubject = {
      findMany: jest.fn(async () => [{ isActive: true, subject: SHARED }]),
    };
    const prisma = { client: { gradeSubject } } as any;
    const service = new AdminCurriculumService(prisma, {} as any, {} as any, {} as any, {} as any);

    await expect(service.listSubjects("grade-uk-6")).resolves.toEqual([SHARED]);
    expect(gradeSubject.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ gradeId: "grade-uk-6", isActive: true }) }),
    );
  });
});
