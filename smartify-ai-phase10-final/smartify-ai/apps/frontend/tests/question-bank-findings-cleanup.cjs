// Phase 10F.6: covers the 3 fixes made after the real-browser E2E findings
// in Phase 10F.5 — stale diagnostic placeholder notice removed, incomplete
// Mock Exam notice (dynamic, never hardcoded), and locale-aware explanation
// rendering (Arabic prefers explanationAr, falls back to explanationEn).
const test = require('node:test');
const assert = require('node:assert/strict');
const { mount } = require('./component-harness.cjs');

const REAL_QUESTION = {
  id: 'q1', subjectId: 'subject-math', subjectNameEn: 'Mathematics', subjectNameAr: 'الرياضيات',
  type: 'MULTIPLE_CHOICE', promptEn: 'What is 2 + 2?', promptAr: 'كم يساوي 2 + 2؟',
  optionsJson: ['3', '4', '5'], isPlaceholder: false,
};

// ---- 1: stale placeholder notice absent from Diagnostic ----
test('1: stale "placeholder question bank" notice is gone from Diagnostic (EN + AR)', async () => {
  for (const locale of ['en', 'ar']) {
    const page = await mount(
      'app/[locale]/onboarding/diagnostic/page.tsx',
      async (url) => (url === '/onboarding/diagnostic' ? [REAL_QUESTION] : []),
      locale,
    );
    const text = page.text();
    assert.doesNotMatch(text, /placeholder question bank/i);
    assert.doesNotMatch(text, /بنك أسئلة تجريبي/);
    assert.doesNotMatch(text, /not final curriculum content/i);
    assert.doesNotMatch(text, /محتوى المنهج النهائي/);
  }
});

// ---- Practice: EN/AR explanation source ----
async function mountPracticeWithFeedback(locale, feedback) {
  const calls = [];
  const apiFetch = async (url, opts) => {
    calls.push(url);
    if (url === '/dashboard/summary') return { subjects: [{ id: 's1', nameEn: 'Math', nameAr: 'رياضيات' }] };
    if (url.startsWith('/practice/topics')) return [{ id: 't1', nameEn: 'Topic', nameAr: 'موضوع', accuracyPercent: null }];
    if (url.startsWith('/practice/questions')) return { questions: [REAL_QUESTION] };
    if (url === '/practice/submit') return { correctCount: 0, total: 1, feedback };
    throw new Error('Unexpected request: ' + url);
  };
  const page = await mount('app/[locale]/practice/page.tsx', apiFetch, locale);
  await page.click(locale === 'ar' ? 'ابدأ التدريب' : 'Start Practice');
  await page.click(locale === 'ar' ? 'إرسال الإجابات' : 'Submit Answers');
  return page;
}

test('9: Practice EN explanation renders explanationEn', async () => {
  const page = await mountPracticeWithFeedback('en', [{ questionId: 'q1', isCorrect: false, correctAnswer: '4', explanationEn: 'English explanation text.', explanationAr: 'نص الشرح بالعربي.' }]);
  assert.match(page.text(), /English explanation text\./);
});

test('10: Practice AR explanation renders explanationAr when present', async () => {
  const page = await mountPracticeWithFeedback('ar', [{ questionId: 'q1', isCorrect: false, correctAnswer: '4', explanationEn: 'English explanation text.', explanationAr: 'نص الشرح بالعربي.' }]);
  const text = page.text();
  assert.match(text, /نص الشرح بالعربي\./);
  assert.doesNotMatch(text, /English explanation text\./);
});

test('11: Practice AR falls back to explanationEn when explanationAr is null', async () => {
  const page = await mountPracticeWithFeedback('ar', [{ questionId: 'q1', isCorrect: false, correctAnswer: '4', explanationEn: 'English explanation text.', explanationAr: null }]);
  assert.match(page.text(), /English explanation text\./);
});

// ---- Topic Quiz: EN/AR explanation source, and warning absence when complete ----
async function mountQuizWithMeta(locale, { quizTypeSelect, questionsMeta, submitBreakdown }) {
  const calls = [];
  const apiFetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url === '/dashboard/summary') return { subjects: [{ id: 's1', nameEn: 'Math', nameAr: 'رياضيات' }] };
    if (url.startsWith('/practice/topics')) return [{ id: 't1', nameEn: 'Topic', nameAr: 'موضوع' }];
    if (url.startsWith('/quizzes/questions')) return { questions: [REAL_QUESTION], ...questionsMeta };
    if (url === '/quizzes/submit') return { id: 'r1', score: 0, correctCount: 0, total: 1, weakTopicsInQuiz: [], recommendedNextSteps: [], breakdown: submitBreakdown };
    throw new Error('Unexpected request: ' + url);
  };
  const page = await mount('app/[locale]/quizzes/page.tsx', apiFetch, locale);
  if (quizTypeSelect) {
    const typeSelect = page.find('select', quizTypeSelect);
    await typeSelect.props.onChange({ target: { value: 'mock_exam' } });
    await page.flush();
  }
  await page.click(locale === 'ar' ? 'ابدأ الاختبار' : 'Start Quiz');
  return { page, calls };
}

test('3: a complete Topic Quiz (isFullAssessment: true) shows no incomplete-mock warning', async () => {
  const { page } = await mountQuizWithMeta('en', {
    questionsMeta: { requestedCount: 8, returnedCount: 8, isFullAssessment: true },
    submitBreakdown: [],
  });
  assert.doesNotMatch(page.text(), /intended \d+ questions/i);
});

test('4/5/6/7: incomplete Mock Exam shows a warning built from the actual returned/requested counts (EN)', async () => {
  const { page } = await mountQuizWithMeta('en', {
    quizTypeSelect: 'Mock Exam',
    questionsMeta: { requestedCount: 20, returnedCount: 10, isFullAssessment: false },
    submitBreakdown: [],
  });
  const text = page.text();
  assert.match(text, /This practice mock currently contains 10 of the intended 20 questions/);
});

test('4/5/6/8: incomplete Mock Exam shows a warning built from the actual returned/requested counts (AR)', async () => {
  const { page } = await mountQuizWithMeta('ar', {
    quizTypeSelect: 'اختبار تجريبي',
    questionsMeta: { requestedCount: 20, returnedCount: 10, isFullAssessment: false },
    submitBreakdown: [],
  });
  const text = page.text();
  assert.match(text, /الاختبار التجريبي متاح حاليًا بـ 10 أسئلة من أصل 20 سؤالًا/);
});

test('5/6 (varied counts): the warning is never hardcoded — a different actual count changes the rendered text', async () => {
  const { page } = await mountQuizWithMeta('en', {
    quizTypeSelect: 'Mock Exam',
    questionsMeta: { requestedCount: 20, returnedCount: 13, isFullAssessment: false },
    submitBreakdown: [],
  });
  const text = page.text();
  assert.match(text, /This practice mock currently contains 13 of the intended 20 questions/);
  assert.doesNotMatch(text, /contains 10 of the intended 20/);
});

test('20: Quiz EN explanation renders explanationEn', async () => {
  const { page, calls } = await mountQuizWithMeta('en', {
    questionsMeta: { requestedCount: 8, returnedCount: 8, isFullAssessment: true },
    submitBreakdown: [{ questionId: 'q1', promptEn: REAL_QUESTION.promptEn, isCorrect: false, yourAnswer: '3', correctAnswer: '4', explanationEn: 'Quiz EN explanation.', explanationAr: 'شرح الاختبار بالعربي.' }],
  });
  await page.click('Submit Quiz');
  assert.match(page.text(), /Quiz EN explanation\./);
});

test('21: Quiz AR explanation renders explanationAr', async () => {
  const { page } = await mountQuizWithMeta('ar', {
    questionsMeta: { requestedCount: 8, returnedCount: 8, isFullAssessment: true },
    submitBreakdown: [{ questionId: 'q1', promptEn: REAL_QUESTION.promptEn, isCorrect: false, yourAnswer: '3', correctAnswer: '4', explanationEn: 'Quiz EN explanation.', explanationAr: 'شرح الاختبار بالعربي.' }],
  });
  await page.click('إرسال الاختبار');
  const text = page.text();
  assert.match(text, /شرح الاختبار بالعربي\./);
  assert.doesNotMatch(text, /Quiz EN explanation\./);
});

test('22: Quiz AR falls back to explanationEn when explanationAr is null', async () => {
  const { page } = await mountQuizWithMeta('ar', {
    questionsMeta: { requestedCount: 8, returnedCount: 8, isFullAssessment: true },
    submitBreakdown: [{ questionId: 'q1', promptEn: REAL_QUESTION.promptEn, isCorrect: false, yourAnswer: '3', correctAnswer: '4', explanationEn: 'Quiz EN explanation.', explanationAr: null }],
  });
  await page.click('إرسال الاختبار');
  assert.match(page.text(), /Quiz EN explanation\./);
});
