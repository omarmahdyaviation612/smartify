// Privacy/Terms are async Server Components (params is a Promise, no hooks),
// which the client-component harness (component-harness.cjs) can't mount —
// it calls Page() synchronously with no arguments. This is a small,
// self-contained loader for that shape instead of extending the shared harness.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');

function nodes(node) {
  if (node == null || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node !== 'object') return [node];
  if (typeof node.type === 'function') return nodes(node.type(node.props));
  return [node, ...nodes(node.props?.children)];
}
const text = (node) => nodes(node).filter((n) => typeof n !== 'object').join(' ');
const links = (node) => nodes(node).filter((n) => n?.type === 'a');

const modules = new Map();
function load(filename) {
  if (modules.has(filename)) return modules.get(filename);
  const exportsObj = {};
  modules.set(filename, exportsObj);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const importer = (name) => {
    if (name === 'react') return React;
    if (name === 'next/image') return { __esModule: true, default: 'img' };
    if (name === 'next/link') return { __esModule: true, default: 'a' };
    if (name === '@smartify/ui') return { SmartifyButton: 'button', SmartifyContainer: 'div' };
    if (name === '@/components/Navbar') return { Navbar: () => null };
    if (name.startsWith('@/') || name.startsWith('.')) {
      const target = name.startsWith('@/') ? path.join(__dirname, '..', name.slice(2)) : path.resolve(path.dirname(filename), name);
      return load(['.ts', '.tsx', ''].map((ext) => target + ext).find((p) => fs.existsSync(p)));
    }
    return require(name);
  };
  vm.runInNewContext(code, { exports: exportsObj, require: importer, URLSearchParams, URL, console });
  return exportsObj;
}

async function render(file, locale) {
  const Page = load(path.join(__dirname, '..', file)).default;
  const tree = await Page({ params: Promise.resolve({ locale }) });
  return { tree, text: () => text(tree), links: () => links(tree) };
}

for (const locale of ['en', 'ar']) {
  test(`${locale} privacy route renders the privacy policy content`, async () => {
    const page = await render('app/[locale]/privacy/page.tsx', locale);
    const expectedTitle = locale === 'ar' ? 'سياسة الخصوصية' : 'Privacy Policy';
    assert.match(page.text(), new RegExp(expectedTitle));
    assert.match(page.text(), /OpenAI/);
    assert.match(page.text(), /InstaPay|إنستاباي/);
  });

  test(`${locale} terms route renders the terms of service content`, async () => {
    const page = await render('app/[locale]/terms/page.tsx', locale);
    const expectedTitle = locale === 'ar' ? 'شروط الخدمة' : 'Terms of Service';
    assert.match(page.text(), new RegExp(expectedTitle));
    assert.match(page.text(), /InstaPay|إنستاباي/);
  });

  test(`${locale} terms route does not claim an automatic refund guarantee`, async () => {
    const page = await render('app/[locale]/terms/page.tsx', locale);
    assert.doesNotMatch(page.text(), /guaranteed? refund|استرداد مضمون/i);
  });

  test(`${locale} privacy route does not claim unverified compliance certifications`, async () => {
    const page = await render('app/[locale]/privacy/page.tsx', locale);
    assert.doesNotMatch(page.text(), /GDPR|COPPA|ISO certified|PCI/);
  });

  test(`${locale} footer links to the correct localized privacy and terms routes`, async () => {
    const page = await render('app/[locale]/privacy/page.tsx', locale);
    const hrefs = page.links().map((a) => a.props.href);
    assert.ok(hrefs.includes(`/${locale}/privacy`), 'missing privacy link');
    assert.ok(hrefs.includes(`/${locale}/terms`), 'missing terms link');
  });

  test(`${locale} privacy route discloses cookies, parent/student linking, and voice input handling (Phase 9.3 re-verification)`, async () => {
    const page = await render('app/[locale]/privacy/page.tsx', locale);
    const text = page.text();
    assert.match(text, locale === 'ar' ? /ملفات تعريف الارتباط/ : /[Cc]ookies?/);
    assert.match(text, locale === 'ar' ? /sf_locale/ : /sf_locale/);
    assert.match(text, locale === 'ar' ? /رمز دعوة/ : /invitation code/);
    assert.match(text, locale === 'ar' ? /الإدخال الصوتي/ : /[Vv]oice input/);
    assert.match(text, locale === 'ar' ? /التعرف على الكلام/ : /speech recognition/i);
  });

  test(`${locale} terms route states there is no guarantee of grades or educational outcomes`, async () => {
    const page = await render('app/[locale]/terms/page.tsx', locale);
    assert.match(page.text(), locale === 'ar' ? /لا يضمن استخدام سمارتيفاي/ : /does not guarantee any particular grade/);
  });
}
