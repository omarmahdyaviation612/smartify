import { ForbiddenException } from "@nestjs/common";
import { DashboardService } from "../dashboard/dashboard.service";
import { PracticeService } from "../practice/practice.service";
import { InteractiveLessonService } from "../interactive-lesson/interactive-lesson.service";
import { TutorService } from "../tutor/tutor.service";
import { QuizzesService } from "../quizzes/quizzes.service";
import { RolesGuard } from "./guards/roles.guard";
import { UserRole } from "@smartify/shared-types";

const subjects = [
  { id: "math", nameEn: "Mathematics", gradeId: "y5", isActive: true, grade: { curriculumId: "british", isActive: true } },
  { id: "english", nameEn: "English", gradeId: "y5", isActive: true, grade: { curriculumId: "british", isActive: true } },
  { id: "draft", gradeId: "y5", isActive: false, grade: { curriculumId: "british", isActive: true } },
  { id: "y6", gradeId: "y6", isActive: true, grade: { curriculumId: "british", isActive: true } },
  { id: "egypt", gradeId: "y5", isActive: true, grade: { curriculumId: "egypt", isActive: true } },
];
function harness(testStudent = false) {
  const profile = { id: "student", userId: "user", curriculumId: "british", gradeId: "y5", fullName: "Student",
    user: { role: "STUDENT", isTestStudent: testStudent }, curriculum: {}, grade: {}, learningPlans: [],
    subjects: [{ subjectId: "math", expiresAt: null, subject: subjects[0] }] };
  const matches = (s: any, w: any) => (!w.id || s.id === w.id) && s.gradeId === w.gradeId && s.isActive === w.isActive && s.grade.curriculumId === w.grade.curriculumId;
  // Publication gate exactly as main's subjectDiscoveryWhere expresses it
  // (`subject: { isActive: true, grade: { curriculum: { isActive: true } } }`):
  // an INACTIVE subject is not "coarsely" available at all for this grade, so
  // neither `findFirst` nor `findMany` may return it. Without this the mock
  // silently served a draft subject and the access gate passed.
  const coarseMatches = (o: any, w: any) =>
    o.isActive === true && o.subject.isActive === true && (!w.gradeId || o.gradeId === w.gradeId) &&
    // The OFFERING's grade carries the requested curriculumId
    // (`subjectDiscoveryWhere` returns a GradeSubject filter: `grade: { curriculumId }`),
    // and the subject's own curriculum must match too. This fixture deliberately
    // gives the Egyptian subject `gradeId: "y5"` — the same string as British
    // Year 5 — so gradeId alone cannot separate the two curricula.
    (!w.grade?.curriculumId || o.subject.grade.curriculumId === w.grade.curriculumId);
  const offeringMatches = (o: any, w: any) =>
    (!w.gradeId || o.gradeId === w.gradeId) && (!w.subjectId?.in || w.subjectId.in.includes(o.subject.id)) && matches(o.subject, { ...w, id: undefined });
  // A subject's own `isActive` gates availability too: the offering being active
  // is not enough (this is what makes the "draft" subject Forbidden rather than
  // silently served).
  const offeringMatchesActive = (o: any, w: any) => o.subject.isActive === true && offeringMatches(o, w);
  const offerings = subjects.map((s) => ({ id: `off-${s.id}`, gradeId: s.gradeId, subjectId: s.id, isActive: true, subject: s }));
  const prisma: any = { client: {
    studentProfile: { findUnique: jest.fn().mockResolvedValue(profile) },
    subject: { findMany: jest.fn(async ({where}) => subjects.filter(s => matches(s, where))), findFirst: jest.fn(async ({where}) => subjects.find(s => matches(s, where)) ?? null) },
    gradeSubject: {
      // Deliberately NOT conditioned on profile.user.isTestStudent: the test
      // marker bypasses ENTITLEMENT, never discovery scope. A test student still
      // cannot see a draft / other-grade / other-curriculum subject — which is
      // exactly what these cases assert.
      findMany: jest.fn(async ({where}) => offerings.filter(o => offeringMatchesActive(o, where))),
      findFirst: jest.fn(async ({where}) => offerings.filter(o => coarseMatches(o, where)).find(o => o.subject.id === where.subjectId) ?? null),
    },
    studentSubject: { findUnique: jest.fn(async ({where}) => profile.subjects.find(s => s.subjectId === where.studentId_subjectId.subjectId) ?? null) },
    // sendMessage reads the subscription AFTER the subject gate; without it the
    // successful-access cases threw a TypeError instead of asserting behavior.
    subscription: { findUnique: jest.fn().mockResolvedValue(null) },
    assessment: {findFirst: jest.fn().mockResolvedValue(null)}, questionAttempt: {findMany: jest.fn().mockResolvedValue([])},
    topic: {findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue({id:"topic", unit:{subjectId:"english"}, teachingStepsJson:null})},
    lessonSession: {findMany: jest.fn().mockResolvedValue([])},
  }};
  const trialSpy = { isSubjectTrialBrowsable: jest.fn(async () => { if (process.env.DIAG) console.log("DIAG isSubjectTrialBrowsable called"); return false; }), isTopicTrialAccessible: jest.fn(async () => false) } as any;
  const accuracy: any = {getPerTopicAccuracy: jest.fn().mockResolvedValue([])};
  return {prisma, profile, accuracy, trialSpy};
}
test("normal discovery includes locked English but no draft/other grade/curriculum", async () => {
  const h = harness();
  const result = await new DashboardService(h.prisma, h.accuracy).getSummary("user");
  expect(result.subjects).toEqual(expect.arrayContaining([expect.objectContaining({id:"math", entitlement:"ACTIVE"}), expect.objectContaining({id:"english", entitlement:"LOCKED"})]));
  expect(result.subjects).toHaveLength(2);
  expect(result.pilotLessons).toEqual([]);
});
test("test discovery makes only published subjects in own scope active", async () => {
  const h = harness(true);
  const result = await new DashboardService(h.prisma, h.accuracy).getSummary("user");
  expect(result.subjects).toHaveLength(2);
  expect(result.subjects.every((s:any) => s.entitlement === "ACTIVE")).toBe(true);
});
for (const testStudent of [false,true]) for (const id of ["draft","y6","egypt"]) {
  test(`practice denies ${id}, test marker=${testStudent}`, async () => {
    const h = harness(testStudent);
    const service = new PracticeService(h.prisma,h.accuracy,{} as any,h.trialSpy);
    await expect(service.getTopicsForSubject("user",id)).rejects.toThrow(ForbiddenException);
    expect(h.prisma.client.topic.findMany).not.toHaveBeenCalled();
  });
}
test("test student has direct English subject access without provider calls", async () => {
  const h = harness(true);
  const service = new PracticeService(h.prisma,h.accuracy,{} as any,{isSubjectTrialBrowsable:async()=>false} as any);
  await expect(service.getTopicsForSubject("user","english")).resolves.toEqual([]);
});
test("locked direct lesson request rejects before preparation", async () => {
  const h = harness();
  const draft: any = {ensureTopicHasLesson:jest.fn(), getTopicGroundingPreparationStatus:jest.fn()};
  const service = new InteractiveLessonService(h.prisma,{} as any,{} as any,{} as any,{} as any,{isSubjectTrialBrowsable:async()=>false} as any,draft,{} as any);
  await expect(service.advance("user","topic")).rejects.toThrow(ForbiddenException);
  expect(draft.ensureTopicHasLesson).not.toHaveBeenCalled();
  await expect(service.getState("user","topic")).rejects.toThrow(ForbiddenException);
  expect(draft.getTopicGroundingPreparationStatus).not.toHaveBeenCalled();
});
for (const testStudent of [false,true]) for(const id of ["draft","y6","egypt",...(testStudent?[]:["english"])]) {
  test(`Tutor and Quiz reject ${id} before content/provider, test marker=${testStudent}`,async()=>{
    const h=harness(testStudent);
    const provider={getActiveProvider:jest.fn()};
    // assertWithinBudget sits BEFORE the subscription gate in sendMessage, so it
    // must resolve for the subject-scope assertion to be the thing under test.
    const usageMock={assertWithinBudget:jest.fn().mockResolvedValue(undefined)} as any;
    const tutor=new TutorService(h.prisma,provider as any,{} as any,usageMock,{} as any,{} as any);
    const quiz=new QuizzesService(h.prisma,h.accuracy,{} as any,{} as any);
    await expect(tutor.sendMessage("user",{subjectId:id,message:"fixture"})).rejects.toThrow(ForbiddenException);
    await expect(quiz.getQuizQuestions("user",id,"mock_exam")).rejects.toThrow(ForbiddenException);
    expect(provider.getActiveProvider).not.toHaveBeenCalled();
    expect(h.prisma.client.topic.findMany).not.toHaveBeenCalled();
  });
}
test("test flag cannot grant administrative capability",()=>{
  const guard=new RolesGuard({getAllAndOverride:()=>[UserRole.SUPER_ADMIN,UserRole.ADMIN]} as any);
  const ctx:any={getHandler:()=>null,getClass:()=>null,switchToHttp:()=>({getRequest:()=>({user:{role:"STUDENT",isTestStudent:true}})})};
  expect(()=>guard.canActivate(ctx)).toThrow(ForbiddenException);
});
test("test Tutor subject access retains daily limits rather than the exhausted free trial",async()=>{
  const h=harness(true);
  h.prisma.client.subscription={findUnique:jest.fn().mockResolvedValue(null)};
  const packs:any={getRemaining:jest.fn().mockResolvedValue({dailyRemaining:10,totalRemaining:10})};
  const tutor=new TutorService(h.prisma,{} as any,{} as any,{} as any,packs,{} as any);
  expect(await tutor.getRemainingToday("user","english")).toMatchObject({totalRemaining:10,isFreeTrial:false});
});
test("a non-STUDENT role with a test marker receives no subject bypass",async()=>{
  const h=harness(true); h.profile.user.role="ADMIN";
  await expect(new PracticeService(h.prisma,h.accuracy,{} as any,{isSubjectTrialBrowsable:async()=>false} as any).getTopicsForSubject("user","english")).rejects.toThrow(ForbiddenException);
});
