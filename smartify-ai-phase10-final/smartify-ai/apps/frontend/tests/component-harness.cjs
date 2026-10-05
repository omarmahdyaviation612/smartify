// Runs the real page handlers/effects with controlled API and routing boundaries.
// No browser, external service, or database; UI behavior is also checked in Chrome.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');

exports.mount = async function mount(file, apiFetch, locale = 'en', options = {}) {
  const slots = [], effects = [], cleanups = [];
  let cursor = 0, dirty = true, tree;
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { const next = typeof value === 'function' ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }];
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
    const exports = {};
    modules.set(filename, exports);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const importer = name => {
      if (options.modules?.[name]) return options.modules[name];
      if (name === 'react') return hooks;
      if (name === 'next/navigation') return { useParams: () => ({ locale }), useRouter: () => options.router ?? ({ push() {}, replace() {}, back() {} }), useSearchParams: () => new URLSearchParams(options.searchParams) };
      if (name === 'next/link') return { __esModule: true, default: 'a' };
      if (name === '@clerk/nextjs') return { useAuth: () => ({ isLoaded: true, isSignedIn: true }) };
      if (name === '@smartify/ui') return { SmartifyButton: 'button', SmartifyContainer: 'div' };
      if (name === '@/components/Navbar') return { Navbar: () => null };
      if (name === '@/lib/api-client') return { useApiClient: () => ({ apiFetch }), ApiError };
      if (name.startsWith('@/') || name.startsWith('.')) {
        const target = name.startsWith('@/') ? path.join(__dirname, '..', name.slice(2)) : path.resolve(path.dirname(filename), name);
        return load(['.ts', '.tsx', ''].map(ext => target + ext).find(p => fs.existsSync(p)));
      }
      return require(name);
    };
    vm.runInNewContext(code, { exports, require: importer, URLSearchParams, URL, console, setTimeout, clearTimeout });
    return exports;
  }
  const Page = load(path.join(__dirname, '..', file)).default;
  function nodes(node) {
    if (node == null || typeof node === 'boolean') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (typeof node !== 'object') return [node];
    if (typeof node.type === 'function') return nodes(node.type(node.props));
    return [node, ...nodes(node.props?.children)];
  }
  const text = node => nodes(node).filter(n => typeof n !== 'object').join(' ');
  async function flush() {
    for (let i = 0; i < 30; i++) {
      if (dirty) { dirty = false; cursor = 0; tree = Page(); }
      effects.splice(0).forEach(fn => fn());
      await new Promise(resolve => setImmediate(resolve));
      if (!dirty && !effects.length) return;
    }
    throw Error('Page did not settle');
  }
  await flush();
  return { flush, text: () => text(tree), nodes: () => nodes(tree),
    find: (type, label) => nodes(tree).find(n => n?.type === type && (!label || text(n).includes(label))),
    async click(label) { const button = this.find('button', label); if (!button) throw Error('Missing button: ' + label); if (!button.props.disabled) await button.props.onClick(); await flush(); },
  };
};
