const test = require('node:test');
const assert = require('node:assert/strict');
const { mount } = require('./component-harness.cjs');

for (const locale of ['en','ar']) {
  for (const flow of ['practice','quizzes']) {
    const file = `app/[locale]/${flow}/page.tsx`;
    const start = locale === 'ar' ? (flow === 'practice' ? 'ابدأ التدريب' : 'ابدأ الاختبار') : (flow === 'practice' ? 'Start Practice' : 'Start Quiz');
    test(`${locale} ${flow}: missing topics explain unavailable content and prevent question/attempt requests`, async () => {
      const calls = [];
      const page = await mount(file, async (url, opts) => {
        calls.push({url, opts});
        if (url === '/dashboard/summary') return {subjects:[{id:'s',nameEn:'English',nameAr:'اللغة الإنجليزية'}]};
        if (url.startsWith('/practice/topics')) return [];
        throw Error('Unexpected request');
      }, locale);
      assert.match(page.text(), locale === 'ar' ? /موضوعات.*غير متاح/ : /topics.*not.*available/i);
      assert.equal(page.find('button', start).props.disabled, true);
      await page.click(start);
      assert.equal(calls.length, 2);
      assert.ok(page.find('a'));
    });
    test(`${locale} ${flow}: failed question request is visible and can be retried`, async () => {
      let fails = true;
      const page = await mount(file, async url => {
        if (url === '/dashboard/summary') return {subjects:[{id:'s',nameEn:'English',nameAr:'اللغة الإنجليزية'}]};
        if (url.startsWith('/practice/topics')) return [{id:'t',nameEn:'Topic',nameAr:'موضوع',accuracyPercent:null}];
        if (fails) throw Error('network');
        return {questions:[{id:'q',promptEn:'Fixture question',promptAr:'سؤال تجريبي',optionsJson:['A','B']}]};
      }, locale);
      await page.click(start);
      assert.ok(page.nodes().some(n=>n?.props?.role === 'alert'));
      fails = false;
      await page.click(start);
      assert.match(page.text(), locale === 'ar' ? /سؤال تجريبي/ : /Fixture question/);
    });
    test(`${locale} ${flow}: an empty question set cannot be submitted`, async () => {
      const page = await mount(file, async url => url === '/dashboard/summary' ? {subjects:[{id:'s'}]} : url.startsWith('/practice/topics') ? [{id:'t'}] : {questions:[]}, locale);
      await page.click(start);
      assert.ok(page.nodes().some(n=>n?.props?.role === 'alert'));
      assert.equal(page.find('button', locale === 'ar' ? (flow === 'practice' ? 'إرسال الإجابات' : 'إرسال الاختبار') : (flow === 'practice' ? 'Submit Answers' : 'Submit Quiz')), undefined);
    });
  }
  test(`${locale} billing: Grade 3 displays existing Grade 1-5 plan without a subscription`, async () => {
    const page = await mount('app/[locale]/billing/page.tsx', async url => url === '/billing/subscription' ? null : [{id:'p',gradeLevel:3,levelCodeEn:'Grade 1-5',levelCodeAr:'الصف 1-5',monthlyPriceEGP:'500',includedSubjects:3,additionalSubjectPriceEGP:'200',subjects:[],basicSubjectIds:[]}], locale);
    assert.match(page.text(), /500/);
  });
  test(`${locale} billing: load failure remains visible without a selected plan`, async () => {
    const page = await mount('app/[locale]/billing/page.tsx', async () => {throw Error('network');}, locale);
    assert.ok(page.nodes().some(n=>n?.props?.role === 'alert'));
  });
  for (const status of ['unverified','pending','failed','verified']) {
    test(`${locale} success route renders backend ${status} instead of unconditional success`, async () => {
      const page = await mount('app/[locale]/billing/success/page.tsx', async url => {assert.equal(url,'/billing/payment-status'); return {status};}, locale);
      if (status !== 'verified') assert.doesNotMatch(page.text(), /You're subscribed!|تم الاشتراك!/);
      assert.ok(page.nodes().some(n=>n?.props?.['data-payment-status'] === status));
    });
  }
  test(`${locale} success route fails closed on request failure`, async () => {
    const page = await mount('app/[locale]/billing/success/page.tsx', async () => {throw Error('offline');}, locale);
    assert.ok(page.nodes().some(n=>n?.props?.['data-payment-status'] === 'unverified'));
  });
}
