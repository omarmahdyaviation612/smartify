const test = require('node:test');
const assert = require('node:assert/strict');
const {mount} = require('./component-harness.cjs');
const subjects = [{id:'math',nameEn:'Mathematics',nameAr:'رياضيات',entitlement:'ACTIVE'}, {id:'english',nameEn:'English',nameAr:'الإنجليزية',entitlement:'LOCKED'}];
const summary = {fullName:'Student',curriculum:{nameEn:'British',nameAr:'بريطاني'},grade:{nameEn:'Year 5',nameAr:'السنة الخامسة'},subjects,pilotLessons:[],diagnosticScore:null,recommendedFocus:null,weakTopics:[],recentActivity:[],achievements:[],upcomingExams:[],aiTutorAvailable:true};
const modules = {'@/lib/use-current-user':{useCurrentUser:()=>({user:{role:'STUDENT'},loading:false})},
  '@/components/StudentLinkCodeCard':{StudentLinkCodeCard:()=>null}, '@/components/FreeTrialCard':{FreeTrialCard:()=>null}, '@/components/ReferralCard':{ReferralCard:()=>null}};
for(const locale of ['en','ar']) {
  test(`${locale}: locked dashboard subject routes to billing without revealing lessons`,async()=>{
    const routes=[],requests=[];
    const page=await mount('app/[locale]/dashboard/page.tsx',async url=>{requests.push(url);return summary},locale,{modules,router:{push:p=>routes.push(p)}});
    await page.click(locale==='en'?'English':'الإنجليزية');
    assert.deepEqual(routes,[`/${locale}/billing?subjectId=english`]);
    assert.deepEqual(requests,['/dashboard/summary']);
    assert.equal(page.nodes().find(n=>n?.props?.role==='tab'&&n.props['aria-selected']===true).props.children.flat().includes(locale==='en'?'Mathematics':'رياضيات'),true);
  });
  test(`${locale}: billing preselects exact added subject and retains active subscription subjects`,async()=>{
    const data=subjects.map(s=>({...s,priceEGP:150,grade:summary.grade,curriculum:summary.curriculum}));
    const page=await mount('app/[locale]/billing/page.tsx',async url=>url==='/billing/subjects'?data:{id:'sub',status:'active',monthlyTotalEGP:'150',subjects:[subjects[0]]},locale,{searchParams:'subjectId=english'});
    const boxes=page.nodes().filter(n=>n?.type==='input'&&n.props.type==='checkbox');
    assert.equal(boxes.length,2); assert.ok(boxes.every(n=>n.props.checked));
    assert.match(page.text(),locale==='en'?/English.*Year 5.*British.*150/:/الإنجليزية.*السنة الخامسة.*بريطاني.*150/);
  });
}
for(const flow of ['practice','quizzes']) test(`${flow}: locked deep link redirects before requesting content`,async()=>{
  const routes=[],requests=[];
  await mount(`app/[locale]/${flow}/page.tsx`,async url=>{requests.push(url);return {subjects}},'en',{searchParams:'subjectId=english',router:{replace:p=>routes.push(p)}});
  assert.deepEqual(routes,['/en/billing?subjectId=english']);
  assert.deepEqual(requests,['/dashboard/summary']);
});
