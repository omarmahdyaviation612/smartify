// Phase 9.3 re-verification: proves the InstaPay checkout page never
// displays an "active"/"confirmed" state purely because a receipt was
// uploaded and submitted — the displayed status is always exactly whatever
// the backend returned, and a fresh submission's backend-enforced default
// is PENDING_VERIFICATION (see schema.prisma), never VERIFIED. Uses a
// self-contained loader (mirrors onboarding-diagnostic.cjs) because
// InstapayCheckoutPage uses useSearchParams, which the shared
// component-harness.cjs does not mock (documented pre-existing gap).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');

function makeRunner(apiFetch, locale, searchParams) {
  const slots = [], effects = [];
  let cursor = 0, dirty = true, tree;
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value) => { const next = typeof value === 'function' ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }];
    },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((dep, i) => !Object.is(dep, slots[index][i]))) {
        slots[index] = deps;
        effects.push(fn);
      }
    },
  };
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
      if (name === 'next/navigation') return { useParams: () => ({ locale }), useSearchParams: () => searchParams };
      if (name === 'next/link') return { __esModule: true, default: 'a' };
      if (name === '@smartify/ui') return { SmartifyButton: 'button', SmartifyContainer: 'div' };
      if (name === '@/components/Navbar') return { Navbar: () => null };
      if (name === '@/lib/api-client') return { useApiClient: () => ({ apiFetch }) };
      if (name.startsWith('@/') || name.startsWith('.')) {
        const target = name.startsWith('@/') ? path.join(__dirname, '..', name.slice(2)) : path.resolve(path.dirname(filename), name);
        return load(['.ts', '.tsx', ''].map((ext) => target + ext).find((p) => fs.existsSync(p)));
      }
      return require(name);
    };
    vm.runInNewContext(code, { exports: exportsObj, require: importer, URLSearchParams, URL, console, setTimeout, clearTimeout, FormData: globalThis.FormData, File: globalThis.File });
    return exportsObj;
  }
  const Page = load(path.join(__dirname, '..', 'app/[locale]/billing/instapay/page.tsx')).default;
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
      const pending = effects.splice(0);
      for (const fn of pending) await fn();
      await new Promise((resolve) => setImmediate(resolve));
      if (!dirty && !effects.length) return;
    }
    throw new Error('Page did not settle');
  }
  return {
    flush,
    text: () => text(tree),
    find: (type, label) => nodes(tree).find((n) => n?.type === type && (!label || text(n).includes(label))),
    findAll: (type) => nodes(tree).filter((n) => n?.type === type),
    async submitForm(fillFn) {
      const form = this.find('form');
      if (fillFn) fillFn(this);
      await form.props.onSubmit({ preventDefault() {} });
      await flush();
    },
  };
}

async function mountInstapay(apiFetch, locale) {
  const searchParams = new URLSearchParams({ kind: 'subscription', pricingPlanId: 'plan-1' });
  const runner = makeRunner(apiFetch, locale, searchParams);
  await runner.flush();
  return runner;
}

for (const locale of ['en', 'ar']) {
  test(`${locale}: submitting an InstaPay receipt shows "pending verification", never "confirmed"/"active"`, async () => {
    const calls = [];
    const apiFetch = async (url, opts) => {
      calls.push(url);
      if (url === '/instapay/subscription/initiate') {
        return { referenceId: 'REF123', expectedAmountEGP: 150, recipientName: 'Smartify', recipientHandle: '01000000000', instructionsEn: 'Transfer via InstaPay', instructionsAr: 'حوّل عبر إنستاباي' };
      }
      if (url === '/instapay/submissions') {
        // Real backend behavior: a NEW submission is always created with the
        // DB-enforced default PENDING_VERIFICATION — never VERIFIED at creation.
        return { status: 'PENDING_VERIFICATION' };
      }
      throw new Error('Unexpected request: ' + url);
    };

    const page = await mountInstapay(apiFetch, locale);
    // Simulate having a receipt file selected by driving the same
    // onChange path the real DOM file picker would — the harness has no
    // real DOM, so we call the handler directly with a fake FileList.
    const inputs = page.findAll('input');
    const fileField = inputs.find((n) => n.props.type === 'file');
    await fileField.props.onChange({ target: { files: [{ type: 'image/png', size: 1000, name: 'receipt.png' }] } });
    await page.flush();

    const amountField = page.findAll('input').find((n) => n.props.type === 'number');
    await amountField.props.onChange({ target: { value: '150' } });
    await page.flush();

    await page.submitForm();

    const text = page.text();
    assert.equal(calls.includes('/instapay/submissions'), true, 'submission was actually sent to the backend');
    assert.doesNotMatch(text, /Payment confirmed|تم تأكيد الدفع/, 'must never claim confirmed from an upload alone');
    assert.doesNotMatch(text, /active|مفعّل/i, 'must never claim active from an upload alone');
    assert.match(text, locale === 'ar' ? /قيد التحقق/ : /Pending verification/);
  });

  test(`${locale}: if the backend ever returned VERIFIED on submit, the UI would show confirmed (proves display is backend-driven, not hardcoded)`, async () => {
    const apiFetch = async (url) => {
      if (url === '/instapay/subscription/initiate') {
        return { referenceId: 'REF456', expectedAmountEGP: 150, recipientName: 'Smartify', recipientHandle: '01000000000', instructionsEn: 'Transfer via InstaPay', instructionsAr: 'حوّل عبر إنستاباي' };
      }
      if (url === '/instapay/submissions') return { status: 'VERIFIED' };
      throw new Error('Unexpected request: ' + url);
    };
    const page = await mountInstapay(apiFetch, locale);
    const fileField = page.findAll('input').find((n) => n.props.type === 'file');
    await fileField.props.onChange({ target: { files: [{ type: 'image/png', size: 1000, name: 'receipt.png' }] } });
    await page.flush();
    const amountField = page.findAll('input').find((n) => n.props.type === 'number');
    await amountField.props.onChange({ target: { value: '150' } });
    await page.flush();
    await page.submitForm();

    assert.match(page.text(), locale === 'ar' ? /تم تأكيد الدفع/ : /Payment confirmed/);
  });
}
