const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');

function load(file, imports) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => imports[name], URL, process: { env: {} } });
  return exports;
}
const middleware = load('middleware.ts', {
  '@clerk/nextjs/server': { clerkMiddleware: callback => callback },
  'next/server': { NextResponse: {
    next: () => ({ kind: 'next', cookies: { set() {} } }),
    redirect: url => ({ kind: 'redirect', url: String(url) }),
  } },
}).default;
const { getOnboardingPrerequisite, sanitizeNextPath } = load('lib/onboarding-draft.ts', {});
function request(route, cookie) {
  const url = new URL(route, 'http://localhost:3001');
  return { url: String(url), nextUrl: Object.assign(url, { clone: () => new URL(url) }), cookies: { get: () => cookie ? { value: cookie } : undefined } };
}
for (const locale of ['ar', 'en']) {
  for (const route of ['', '/pricing', '/curricula', '/sign-in', '/sign-up', '/privacy', '/terms']) {
    test(`${locale}${route}: public path does not invoke protection`, async () => {
      const result = await middleware(async () => { throw Error('unexpected auth call'); }, request(`/${locale}${route}`));
      assert.equal(result.kind, 'next');
    });
  }
  for (const route of ['profile', 'curriculum', 'grade-subjects', 'diagnostic', 'plan-ready']) {
    test(`${locale}/${route}: signed-out middleware preserves localized sign-in redirect`, async () => {
      assert.throws(() => middleware(() => ({ protect: opts => {
        const destination = new URL(opts.unauthenticatedUrl);
        assert.equal(destination.pathname, `/${locale}/sign-in`);
        assert.equal(destination.searchParams.get('redirect_url'), `http://localhost:3001/${locale}/onboarding/${route}`);
        throw Error('clerk-protect-redirect');
      } }), request(`/${locale}/onboarding/${route}`)), /clerk-protect-redirect/);
    });
    test(`${locale}/${route}: authenticated middleware continues after protection`, async () => {
      let called = false;
      const result = await middleware(() => ({ protect: () => { called = true; } }), request(`/${locale}/onboarding/${route}`));
      assert.equal(called, true);
      assert.equal(result.kind, 'next');
    });
  }
}
test('locale-less routing defaults Arabic and honors English cookie', async () => {
  assert.equal((await middleware(null, request('/pricing'))).url, 'http://localhost:3001/ar/pricing');
  assert.equal((await middleware(null, request('/pricing', 'en'))).url, 'http://localhost:3001/en/pricing');
});
test('onboarding draft prerequisites preserve profile and curriculum ordering', async () => {
  assert.equal(getOnboardingPrerequisite({}, 'curriculum'), 'profile');
  const profile = { fullName: 'Test Student', age: 12, country: 'EG' };
  assert.equal(getOnboardingPrerequisite(profile, 'curriculum'), null);
  assert.equal(getOnboardingPrerequisite(profile, 'grade-subjects'), 'curriculum');
  assert.equal(getOnboardingPrerequisite({ ...profile, curriculumId: 'test', curriculumCode: 'LOCAL' }, 'grade-subjects'), null);
});
test('step 1 no longer requires a country (it defaults to Egypt later)', () => {
  assert.equal(getOnboardingPrerequisite({ fullName: 'Test Student', age: 12 }, 'curriculum'), null);
  assert.equal(getOnboardingPrerequisite({ fullName: 'Test Student' }, 'curriculum'), 'profile');
});
test('post-onboarding destination only accepts same-site app paths', () => {
  assert.equal(sanitizeNextPath('/free-trial'), '/free-trial');
  assert.equal(sanitizeNextPath('/billing'), '/billing');
  for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', 'free-trial', '', null]) assert.equal(sanitizeNextPath(bad), null);
});
