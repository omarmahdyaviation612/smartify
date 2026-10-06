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
  const matches = (s: any, w: any) => (!w.id || s.id === w.id) && (w.sharedContentSubjectId === undefined || s.sharedContentSubjectId === w.sharedContentSubjectId) && s.gradeId === w.gradeId && s.isActive === w.isActive && s.grade.curriculumId === w.grade.curriculumId;
  const prisma: any = { client: {
    studentProfile: { findUnique: jest.fn().mockResolvedValue(profile) },
    subject: { findMany: jest.fn(async ({where}) => subjects.filter(s => matches(s, where))), findFirst: jest.fn(async ({where}) => subjects.find(s => matches(s, where)) ?? null) },
    studentSubject: { findUnique: jest.fn(async ({where}) => profile.subjects.find(s => s.subjectId === where.studentId_subjectId.subjectId) ?? null) },
    assessment: {findFirst: jest.fn().mockResolvedValue(null)}, questionAttempt: {findMany: jest.fn().mockResolvedValue([])},
    topic: {findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue({id:"topic", unit:{subjectId:"english"}, teachingStepsJson:null})},
    lessonSession: {findMany: jest.fn().mockResolvedValue([])},
  }};
  const accuracy: any = {getPerTopicAccuracy: jest.fn().mockResolvedValue([])};
  return {prisma, profile, accuracy};
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
    const service = new PracticeService(h.prisma,h.accuracy,{} as any,{isSubjectTrialBrowsable:async()=>false} as any);
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
    const tutor=new TutorService(h.prisma,provider as any,{} as any,{} as any,{} as any,{} as any);
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
