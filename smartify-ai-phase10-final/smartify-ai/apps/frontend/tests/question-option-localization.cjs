// Phase 10F.3: proves the locale-aware option label fix end-to-end across
// every student-facing renderer (Diagnostic, Practice, Topic Quiz, Mock
// Exam) — that Arabic students SEE localized labels while the CANONICAL
// "True"/"False" value is what actually gets submitted to the backend.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mount } = require('./component-harness.cjs');

// input nodes and their visible label text end up adjacent in the
// flattened node list (see component-harness.cjs's `nodes()`), because
// each <label>...<input/>{label}</label> block compiles to
// [labelElement, inputElement, labelString] in that exact order.
function findRadioByVisibleLabel(page, labelText) {
  const flat = page.nodes();
  for (let i = 1; i < flat.length; i++) {
    if (flat[i] === labelText && flat[i - 1]?.type === 'input') return flat[i - 1];
  }
  throw new Error(`No radio input found with visible label "${labelText}"`);
}

async function selectRadio(page, labelText) {
  const radio = findRadioByVisibleLabel(page, labelText);
  await radio.props.onChange();
  await page.flush();
}

const TF_QUESTION = {
  id: 'q1',
  type: 'TRUE_FALSE',
  promptEn: '3 + 3 = 6.',
  promptAr: '3 + 3 = 6. هل هذه العبارة صحيحة؟',
  optionsJson: ['True', 'False'],
  isPlaceholder: false,
};

test('9: Diagnostic uses localized labels (Arabic renders صحيح/خطأ, never raw True/False)', async () => {
  const question = { ...TF_QUESTION, subjectId: 'subject-math', subjectNameEn: 'Mathematics', subjectNameAr: 'الرياضيات' };
  const page = await mount('app/[locale]/onboarding/diagnostic/page.tsx', async (url) => (url === '/onboarding/diagnostic' ? [question] : []), 'ar');

  const text = page.text();
  assert.match(text, /صحيح/);
  assert.match(text, /خطأ/);
  assert.doesNotMatch(text, /\bTrue\b/);
  assert.doesNotMatch(text, /\bFalse\b/);
});

test('English behavior is unchanged for Diagnostic (renders literal True/False)', async () => {
  const question = { ...TF_QUESTION, subjectId: 'subject-math', subjectNameEn: 'Mathematics', subjectNameAr: 'الرياضيات' };
  const page = await mount('app/[locale]/onboarding/diagnostic/page.tsx', async (url) => (url === '/onboarding/diagnostic' ? [question] : []), 'en');

  const text = page.text();
  assert.match(text, /\bTrue\b/);
  assert.match(text, /\bFalse\b/);
});

test('10: Practice uses localized labels, and 7/8: selecting صحيح/خطأ submits canonical True/False', async () => {
  const calls = [];
  const apiFetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url === '/dashboard/summary') return { subjects: [{ id: 's1', nameEn: 'Math', nameAr: 'رياضيات' }] };
    if (url.startsWith('/practice/topics')) return [{ id: 't1', nameEn: 'Topic', nameAr: 'موضوع', accuracyPercent: null }];
    if (url.startsWith('/practice/questions')) return { questions: [TF_QUESTION] };
    if (url === '/practice/submit') return { correctCount: 1, total: 1, feedback: [{ questionId: 'q1', isCorrect: true, correctAnswer: 'True', explanationEn: null }] };
    throw new Error('Unexpected request: ' + url);
  };

  const page = await mount('app/[locale]/practice/page.tsx', apiFetch, 'ar');
  await page.click('ابدأ التدريب'); // Start Practice

  const textBeforeSelect = page.text();
  assert.match(textBeforeSelect, /صحيح/);
  assert.match(textBeforeSelect, /خطأ/);
  assert.doesNotMatch(textBeforeSelect, /\bTrue\b/);
  assert.doesNotMatch(textBeforeSelect, /\bFalse\b/);

  await selectRadio(page, 'صحيح'); // pick the Arabic-labeled option
  await page.click('إرسال الإجابات'); // Submit Answers

  const submitCall = calls.find((c) => c.url === '/practice/submit');
  const body = JSON.parse(submitCall.opts.body);
  assert.deepEqual(body.answers, [{ questionId: 'q1', answer: 'True' }]); // canonical value, never "صحيح"
});

test('selecting the Arabic خطأ option submits canonical False', async () => {
  const calls = [];
  const apiFetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url === '/dashboard/summary') return { subjects: [{ id: 's1', nameEn: 'Math', nameAr: 'رياضيات' }] };
    if (url.startsWith('/practice/topics')) return [{ id: 't1', nameEn: 'Topic', nameAr: 'موضوع', accuracyPercent: null }];
    if (url.startsWith('/practice/questions')) return { questions: [TF_QUESTION] };
    if (url === '/practice/submit') return { correctCount: 0, total: 1, feedback: [{ questionId: 'q1', isCorrect: false, correctAnswer: 'True', explanationEn: null }] };
    throw new Error('Unexpected request: ' + url);
  };

  const page = await mount('app/[locale]/practice/page.tsx', apiFetch, 'ar');
  await page.click('ابدأ التدريب');
  await selectRadio(page, 'خطأ');
  await page.click('إرسال الإجابات');

  const body = JSON.parse(calls.find((c) => c.url === '/practice/submit').opts.body);
  assert.deepEqual(body.answers, [{ questionId: 'q1', answer: 'False' }]);
});

test('Practice results screen shows localized correct-answer label, not raw "True"', async () => {
  const apiFetch = async (url) => {
    if (url === '/dashboard/summary') return { subjects: [{ id: 's1', nameEn: 'Math', nameAr: 'رياضيات' }] };
    if (url.startsWith('/practice/topics')) return [{ id: 't1', nameEn: 'Topic', nameAr: 'موضوع', accuracyPercent: null }];
    if (url.startsWith('/practice/questions')) return { questions: [TF_QUESTION] };
    if (url === '/practice/submit') return { correctCount: 0, total: 1, feedback: [{ questionId: 'q1', isCorrect: false, correctAnswer: 'True', explanationEn: null }] };
    throw new Error('Unexpected request: ' + url);
  };
  const page = await mount('app/[locale]/practice/page.tsx', apiFetch, 'ar');
  await page.click('ابدأ التدريب');
  await selectRadio(page, 'خطأ');
  await page.click('إرسال الإجابات');

  assert.match(page.text(), /صحيح/); // localized correct-answer feedback
});

test('11: Topic Quiz uses localized labels', async () => {
  const calls = [];
  const apiFetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url === '/dashboard/summary') return { subjects: [{ id: 's1', nameEn: 'Math', nameAr: 'رياضيات' }] };
    if (url.startsWith('/practice/topics')) return [{ id: 't1', nameEn: 'Topic', nameAr: 'موضوع' }];
    if (url.startsWith('/quizzes/questions')) return { questions: [TF_QUESTION] };
    if (url === '/quizzes/submit') return { id: 'r1', score: 100, correctCount: 1, total: 1, weakTopicsInQuiz: [], recommendedNextSteps: [], breakdown: [{ questionId: 'q1', promptEn: TF_QUESTION.promptEn, isCorrect: true, yourAnswer: 'True', correctAnswer: 'True', explanationEn: null }] };
    throw new Error('Unexpected request: ' + url);
  };

  const page = await mount('app/[locale]/quizzes/page.tsx', apiFetch, 'ar');
  await page.click('ابدأ الاختبار'); // Start Quiz (defaults to topic_assessment)

  const text = page.text();
  assert.match(text, /صحيح/);
  assert.match(text, /خطأ/);
  assert.doesNotMatch(text, /\bTrue\b/);
  assert.doesNotMatch(text, /\bFalse\b/);

  await selectRadio(page, 'صحيح');
  await page.click('إرسال الاختبار'); // Submit Quiz

  const submitCall = calls.find((c) => c.url === '/quizzes/submit');
  const body = JSON.parse(submitCall.opts.body);
  assert.equal(body.type, 'topic_assessment');
  assert.deepEqual(body.answers, [{ questionId: 'q1', answer: 'True' }]);
});

test('12: Mock Exam uses localized labels (same renderer, quizType switched to mock_exam)', async () => {
  const calls = [];
  const apiFetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url === '/dashboard/summary') return { subjects: [{ id: 's1', nameEn: 'Math', nameAr: 'رياضيات' }] };
    if (url.startsWith('/practice/topics')) return [{ id: 't1', nameEn: 'Topic', nameAr: 'موضوع' }];
    if (url.startsWith('/quizzes/questions')) return { questions: [TF_QUESTION] };
    if (url === '/quizzes/submit') return { id: 'r1', score: 100, correctCount: 1, total: 1, weakTopicsInQuiz: [], recommendedNextSteps: [], breakdown: [{ questionId: 'q1', promptEn: TF_QUESTION.promptEn, isCorrect: true, yourAnswer: 'True', correctAnswer: 'True', explanationEn: null }] };
    throw new Error('Unexpected request: ' + url);
  };

  const page = await mount('app/[locale]/quizzes/page.tsx', apiFetch, 'ar');
  const typeSelect = page.find('select', 'اختبار تجريبي'); // "Mock Exam" option text
  await typeSelect.props.onChange({ target: { value: 'mock_exam' } });
  await page.flush();

  await page.click('ابدأ الاختبار');

  const text = page.text();
  assert.match(text, /صحيح/);
  assert.match(text, /خطأ/);
  assert.doesNotMatch(text, /\bTrue\b/);
  assert.doesNotMatch(text, /\bFalse\b/);

  await selectRadio(page, 'خطأ');
  await page.click('إرسال الاختبار');

  const submitCall = calls.find((c) => c.url === '/quizzes/submit');
  const body = JSON.parse(submitCall.opts.body);
  assert.equal(body.type, 'mock_exam');
  assert.deepEqual(body.answers, [{ questionId: 'q1', answer: 'False' }]);
});
