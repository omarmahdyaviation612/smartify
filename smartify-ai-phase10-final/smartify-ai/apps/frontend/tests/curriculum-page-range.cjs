const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { chromium } = require('playwright');

const source = fs.readFileSync(path.join(__dirname, '../app/[locale]/admin/curriculum/page.tsx'), 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ['UnitsTopicsEditor', 'AddExtraBookWizard'].map(name => {
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === name);
  assert.ok(fn, name);
  return fn.getText(ast);
}).join('\n');

test('manual White Fang range remains left/start 1, right/end 81 in RTL and LTR and in the confirm payload', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const direction of ['rtl', 'ltr']) {
      let units = [{ nameEn: 'Story — White Fang', nameAr: 'قصة — White Fang', sourcePageStart: 1, sourcePageEnd: 1, topics: [{ nameEn: 'Chapter 1', nameAr: 'الفصل 1' }] }];
      let payload;
      let cursor = 0;
      const slots = [3, false, '', false, 'White Fang', units, null, null, null];
      const context = {
        require, exports: {}, editorInputCls: '',
        useState: () => { const i = cursor++; return [slots[i], value => { slots[i] = value; }]; },
        useApiClient: () => ({ apiFetch: async (_url, options) => { payload = JSON.parse(options.body); return {}; } }),
      };
      const code = ts.transpileModule(functions + '\nexports.editor = UnitsTopicsEditor; exports.wizard = AddExtraBookWizard;', {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
      }).outputText;
      vm.runInNewContext(code, context);
      const tree = context.exports.editor({ units, onChange: value => { units = value; slots[5] = value; } });
      const page = await browser.newPage();
      await page.setContent(`<html dir="${direction}"><style>.flex{display:flex}.flex-wrap{flex-wrap:wrap}</style>${renderToStaticMarkup(tree)}</html>`);
      const inputs = await page.locator('input[type=number]').all();
      const positions = await Promise.all(inputs.map(async (input, index) => ({ index, x: (await input.boundingBox()).x })));
      positions.sort((a, b) => a.x - b.x);
      assert.equal(positions[0].index, 0, 'start input must be visually left, including under RTL');
      await inputs[positions[0].index].fill('1');
      await inputs[positions[1].index].fill('81');
      const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
      // Drive the real React handlers with the values entered in visual order.
      for (let i = 0; i < inputs.length; i++) {
        const current = context.exports.editor({ units, onChange: value => { units = value; slots[5] = value; } });
        const fields = nodes(current).filter(n => n.type === 'input' && n.props.type === 'number');
        fields[i].props.onChange({ target: { value: await inputs[i].inputValue() } });
      }
      const wizard = context.exports.wizard({ subjectId: 'subject-1', subjectNameEn: 'English Language', onDone() {} });
      const confirm = nodes(wizard).find(n => n.type === 'button' && String(n.props.children).includes('Confirm & Add'));
      assert.ok(confirm);
      await confirm.props.onClick();
      assert.equal(payload.units[0].sourcePageStart, 1);
      assert.equal(payload.units[0].sourcePageEnd, 81);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
