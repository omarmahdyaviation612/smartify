import { BillingService } from "./billing.service";
function harness(providerKey="stripe") {
  const subscription:any={id:"sub",studentId:"student",status:"active",selectedSubjectIds:["math"],monthlyTotalEGP:150,paymentProvider:providerKey,externalProviderSubscriptionId:"sub_existing",externalSubscriptionId:"cs_old",pendingSubjectChange:null};
  const allSubjects=[{id:"math",nameEn:"Math",priceEGP:150},{id:"english",nameEn:"English",priceEGP:175}];
  const prisma:any={client:{studentProfile:{findUnique:jest.fn().mockResolvedValue({id:"student",gradeId:"y5",curriculumId:"british",subjects:[{subjectId:"math"}],grade:{nameEn:"Year 5",nameAr:"السنة ٥"},curriculum:{nameEn:"British",nameAr:"البريطاني"}})},
    subject:{findMany:jest.fn().mockResolvedValue(allSubjects)},
    // Availability is an OFFERING since the shared-subjects merge: billing reads
    // the subject off each GradeSubject row instead of filtering subject.gradeId.
    gradeSubject:{findMany:jest.fn(async({where}:any)=>allSubjects
      .filter(s=>where?.subjectId?.in?where.subjectId.in.includes(s.id):true)
      .map(s=>({id:`off-${s.id}`,gradeId:where.gradeId,subjectId:s.id,isActive:true,subject:s})))},
    subscription:{findUnique:jest.fn(async()=>({...subscription})),findFirst:jest.fn(async()=>({...subscription})),upsert:jest.fn(),update:jest.fn(async({data})=>Object.assign(subscription,data)),updateMany:jest.fn(async({data})=>{Object.assign(subscription,data);return{count:1}})},
    studentSubject:{createMany:jest.fn()},webhookEventLog:{create:jest.fn()}}};
  prisma.client.$transaction=(fn:any)=>fn(prisma.client);
  const provider:any={createCheckoutSession:jest.fn(),createSubscriptionUpgrade:jest.fn().mockResolvedValue({externalSessionId:"sfu:sub_existing:price",checkoutUrl:"https://stripe.test/confirm"})};
  const service=new BillingService(prisma,{getActiveProvider:async()=>({provider,providerKey})} as any,{} as any,{earnRewardWithinTransaction:jest.fn()} as any);
  return{prisma,provider,service,subscription};
}
beforeAll(()=>Object.assign(process.env,{DATABASE_URL:"postgresql://fixture:fixture@localhost/fixture",REDIS_URL:"redis://localhost",CLERK_SECRET_KEY:"fixture",CLERK_PUBLISHABLE_KEY:"fixture",CLERK_WEBHOOK_SIGNING_SECRET:"fixture",FRONTEND_URL:"https://smartify.test"}));
test("adding English preserves active Math and reuses the existing Stripe subscription until verified",async()=>{
  const h=harness();await h.service.startCheckout("user",{subjectIds:["math","english"]});
  expect(h.subscription.status).toBe("active");expect(h.subscription.selectedSubjectIds).toEqual(["math"]);expect(h.subscription.monthlyTotalEGP).toBe(150);
  expect(h.provider.createSubscriptionUpgrade.mock.calls[0][0]).toMatchObject({externalProviderSubscriptionId:"sub_existing",amountEGP:325});
  expect(h.provider.createCheckoutSession).not.toHaveBeenCalled();expect(h.prisma.client.subscription.upsert).not.toHaveBeenCalled();expect(h.prisma.client.studentSubject.createMany).not.toHaveBeenCalled();
  await h.service.applyWebhookEvent("stripe",{type:"subscription.activated",externalSubscriptionId:h.subscription.externalSubscriptionId,externalEventId:"verified"});
  expect(h.subscription.selectedSubjectIds).toEqual(["math","english"]);expect(h.subscription.monthlyTotalEGP).toBe(325);
  expect(h.prisma.client.studentSubject.createMany.mock.calls[0][0]).toMatchObject({data:[{studentId:"student",subjectId:"math"},{studentId:"student",subjectId:"english"}],skipDuplicates:true});
});
test("provider failure preserves the original subscription and clears the proposed change",async()=>{
  const h=harness();h.provider.createSubscriptionUpgrade.mockRejectedValue(new Error("provider unavailable"));
  await expect(h.service.startCheckout("user",{subjectIds:["math","english"]})).rejects.toThrow("provider unavailable");
  expect(h.subscription.status).toBe("active");expect(h.subscription.selectedSubjectIds).toEqual(["math"]);expect(h.prisma.client.studentSubject.createMany).not.toHaveBeenCalled();
});
test("add-subject checkout cannot remove existing subjects or create a duplicate recurring subscription",async()=>{
  const h=harness();h.prisma.client.subject.findMany.mockResolvedValue([{id:"english",nameEn:"English",priceEGP:175}]);
  await expect(h.service.startCheckout("user",{subjectIds:["english"]})).rejects.toThrow(/Keep your current subjects/);
  expect(h.provider.createCheckoutSession).not.toHaveBeenCalled();expect(h.prisma.client.subscription.upsert).not.toHaveBeenCalled();
});
