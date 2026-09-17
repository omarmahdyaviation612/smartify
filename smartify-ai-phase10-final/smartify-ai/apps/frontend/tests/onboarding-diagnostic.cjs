// Phase 10D.1 — diagnostic onboarding fail-safe.
// Self-contained loader (same hooks-dispatcher shape as component-harness.cjs)
// but with a CALL-TRACKING router mock — the shared harness's next/navigation
// mock is a no-op stub with no way to assert the navigation destination,
// which Case 3 specifically needs ("student reaches the existing next step").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');

function makeRunner(apiFetch, locale, router) {
  const slots = [], effects = [], cleanups = [];
  let cursor = 0, dirty = true, tree;
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value) => { const next = typeof value === 'function' ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }];
    },
    useRef(initial) { return hooks.useState(() => ({ current: initial }))[0]; },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((dep, i) => !Object.is(dep, slots[index][i]))) {
        slots[index] = deps;
        effects.push(() => { cleanups[index]?.(); cleanups[index] = fn(); });
      }
    },
    useMemo(fn) { cursor++; return fn(); },
    useCallback(fn) { cursor++; return fn; },
  };
  class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const exportsObj = {};
    modules.set(filename, exportsObj);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const importer = (name) => {
      if (name === 'react') return hooks;
      if (name === 'next/navigation') return { useParams: () => ({ locale }), useRouter: () => router };
      if (name === 'next/link') return { __esModule: true, default: 'a' };
      if (name === '@clerk/nextjs') return { useAuth: () => ({ isLoaded: true, isSignedIn: true }) };
      if (name === '@smartify/ui') return { SmartifyButton: 'button', SmartifyContainer: 'div' };
      if (name === '@/components/Navbar') return { Navbar: () => null };
      if (name === '@/lib/api-client') return { useApiClient: () => ({ apiFetch }), ApiError };
      if (name.startsWith('@/') || name.startsWith('.')) {
        const target = name.startsWith('@/') ? path.join(__dirname, '..', name.slice(2)) : path.resolve(path.dirname(filename), name);
        return load(['.ts', '.tsx', ''].map((ext) => target + ext).find((p) => fs.existsSync(p)));
      }
      return require(name);
    };
    vm.runInNewContext(code, { exports: exportsObj, require: importer, URLSearchParams, URL, console, setTimeout, clearTimeout });
    return exportsObj;
  }
  const Page = load(path.join(__dirname, '..', 'app/[locale]/onboarding/diagnostic/page.tsx')).default;
  function nodes(node) {
    if (node == null || typeof node === 'boolean') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (typeof node !== 'object') return [node];
    if (typeof node.type === 'function') return nodes(node.type(node.props));
    return [node, ...nodes(node.props?.children)];
  }
  const text = (node) => nodes(node).filter((n) => typeof n !== 'object').join(' ');
  async function flush() {
    for (let i = 0; i < 30; i++) {
      if (dirty) { dirty = false; cursor = 0; tree = Page(); }
      effects.splice(0).forEach((fn) => fn());
      await new Promise((resolve) => setImmediate(resolve));
      if (!dirty && !effects.length) return;
    }
    throw new Error('Page did not settle');
  }
  return {
    flush,
    text: () => text(tree),
    find: (type, label) => nodes(tree).find((n) => n?.type === type && (!label || text(n).includes(label))),
    async click(label) {
      const button = this.find('button', label);
      if (!button) throw new Error('Missing button: ' + label);
      if (!button.props.disabled) await button.props.onClick();
      await flush();
    },
  };
}

async function mount(apiFetch, locale) {
  const routerCalls = { push: [], replace: [] };
  const router = { push: (url) => routerCalls.push.push(url), replace: (url) => routerCalls.replace.push(url), back() {} };
  const runner = makeRunner(apiFetch, locale, router);
  await runner.flush();
  return { page: runner, routerCalls };
}

const REAL_QUESTION = {
  id: 'q1', subjectId: 'subject-math', subjectNameEn: 'Mathematics', subjectNameAr: 'الرياضيات',
  type: 'MULTIPLE_CHOICE', promptEn: 'What is 2 + 2?', promptAr: 'كم يساوي 2 + 2؟',
  optionsJson: ['3', '4', '5'], isPlaceholder: false,
};

for (const locale of ['en', 'ar']) {
  test(`${locale} CASE 1 — real Questions available: normal diagnostic renders, no automatic bypass`, async () => {
    const calls = [];
    const { page } = await mount(async (url) => {
      calls.push(url);
      if (url === '/onboarding/diagnostic') return [REAL_QUESTION];
      throw new Error('Unexpected request: ' + url);
    }, locale);

    assert.match(page.text(), locale === 'ar' ? /كم يساوي/ : /What is 2 \+ 2/);
    assert.ok(page.find('button', locale === 'ar' ? 'إرسال الإجابات' : 'Submit Answers'));
    assert.equal(calls.includes('/onboarding/diagnostic/submit'), false);
  });

  test(`${locale} CASE 2 — zero Questions: empty-state fallback with a Continue action appears`, async () => {
    const { page } = await mount(async (url) => (url === '/onboarding/diagnostic' ? [] : Promise.reject(new Error('unexpected'))), locale);

    assert.match(page.text(), locale === 'ar' ? /مش متاح/ : /isn.t available yet/);
    assert.ok(page.find('button', locale === 'ar' ? 'متابعة' : 'Continue'));
    assert.equal(page.find('button', locale === 'ar' ? 'إرسال الإجابات' : 'Submit Answers'), undefined);
  });

  test(`${locale} CASE 3 — Continue with zero Questions navigates straight to plan-ready, never calls submit`, async () => {
    const calls = [];
    const { page, routerCalls } = await mount(async (url) => {
      calls.push(url);
      if (url === '/onboarding/diagnostic') return [];
      throw new Error('Unexpected request during CASE 3: ' + url);
    }, locale);

    await page.click(locale === 'ar' ? 'متابعة' : 'Continue');

    // Reaches the EXISTING next onboarding step (no parallel route).
    assert.deepEqual(routerCalls.push, [`/${locale}/onboarding/plan-ready`]);
    // Submit was never called — no fake Assessment/QuestionAttempt/LearningPlan possible.
    assert.equal(calls.length, 1);
    assert.equal(calls[0], '/onboarding/diagnostic');
  });

  test(`${locale} does not render a Continue fallback button while questions are still loading`, async () => {
    const { page } = await mount(() => new Promise(() => {}), locale); // never resolves
    assert.equal(page.find('button', locale === 'ar' ? 'متابعة' : 'Continue'), undefined);
  });
}
