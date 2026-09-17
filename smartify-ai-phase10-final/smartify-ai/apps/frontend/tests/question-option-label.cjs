// Phase 10F.3: getQuestionOptionLabel is a plain TS utility (no React/DOM),
// so it's loaded directly via ts.transpileModule rather than the full
// component-harness mount() pipeline. `import type { Locale }` is erased
// by the transpiler since it's syntactically type-only — no runtime
// require of "@/content/marketing" is ever attempted.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadHelper() {
  const filename = path.join(__dirname, '..', 'lib', 'question-option-label.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const exportsObj = {};
  const importer = (name) => {
    throw new Error('Unexpected runtime import in a type-only-import file: ' + name);
  };
  vm.runInNewContext(code, { exports: exportsObj, require: importer, console });
  return exportsObj.getQuestionOptionLabel;
}

const getQuestionOptionLabel = loadHelper();

test('1: English True displays "True"', () => {
  assert.equal(getQuestionOptionLabel('True', 'en'), 'True');
});

test('2: English False displays "False"', () => {
  assert.equal(getQuestionOptionLabel('False', 'en'), 'False');
});

test('3: Arabic True displays "صحيح"', () => {
  assert.equal(getQuestionOptionLabel('True', 'ar'), 'صحيح');
});

test('4: Arabic False displays "خطأ"', () => {
  assert.equal(getQuestionOptionLabel('False', 'ar'), 'خطأ');
});

test('5: Arabic numeric option "4" remains "4"', () => {
  assert.equal(getQuestionOptionLabel('4', 'ar'), '4');
});

test('6: Arabic equation option "5 + 2 = 7" remains unchanged', () => {
  assert.equal(getQuestionOptionLabel('5 + 2 = 7', 'ar'), '5 + 2 = 7');
});

test('13: English behavior is unchanged for non-boolean options', () => {
  assert.equal(getQuestionOptionLabel('8 + 2 = 10', 'en'), '8 + 2 = 10');
  assert.equal(getQuestionOptionLabel('9', 'en'), '9');
});

test('14: never mutates or returns a canonical grading value for True/False — label and value are distinct strings in Arabic', () => {
  const label = getQuestionOptionLabel('True', 'ar');
  assert.notEqual(label, 'True'); // the label is localized...
  // ...but the caller is responsible for keeping the ORIGINAL 'True' as the
  // submitted/graded value — this function has no way to mutate that by
  // construction, since it only ever returns a new display string and never
  // touches the option it was given.
});

test('does not translate an option string that merely contains "True"/"False" as a substring', () => {
  assert.equal(getQuestionOptionLabel('True or False', 'ar'), 'True or False');
});
