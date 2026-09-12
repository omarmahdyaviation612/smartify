// Uses an existing Playwright installation; does not add workspace dependencies.
// PLAYWRIGHT_MODULE points at that installation. TEST_BASE_URL defaults to a
// dedicated production server. No logins, API writes, or real user data changes.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const base = process.env.TEST_BASE_URL || 'http://localhost:3001';
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext();
  const page = await context.newPage();
  const results = [];
  try {
    const routes = ['/', '/pricing', '/curricula', '/sign-in', '/sign-up'];
    for (const locale of ['ar', 'en']) {
      routes.push(...['', '/pricing', '/curricula', '/sign-in', '/sign-up',
        '/onboarding/profile', '/onboarding/curriculum', '/onboarding/grade-subjects',
        '/onboarding/diagnostic', '/onboarding/plan-ready', '/dashboard', '/admin'].map(p => `/${locale}${p}`));
    }
    for (const route of routes) {
      const errors = [];
      const warnings = [];
      const failures = [];
      const onError = e => errors.push(e.message);
      const onConsole = e => { if (e.type() === 'error') errors.push(e.text()); if (e.type() === 'warning') warnings.push(e.text()); };
      const onResponse = r => { if (r.status() >= 400) failures.push({ status: r.status(), url: new URL(r.url()).origin + new URL(r.url()).pathname }); };
      page.on('pageerror', onError); page.on('console', onConsole); page.on('response', onResponse);
      const response = await page.goto(base + route, { waitUntil: 'networkidle', timeout: 25000 });
      const finalPath = new URL(page.url()).pathname;
      const redirectChain = [];
      for (let request = response.request(); request; request = request.redirectedFrom()) {
        const parsed = new URL(request.url());
        redirectChain.unshift(parsed.origin + parsed.pathname);
      }
      const locale = route.startsWith('/en') ? 'en' : 'ar';
      const protectedRoute = /onboarding|dashboard|admin/.test(route);
      const expected = protectedRoute ? `/${locale}/sign-in` : route.startsWith('/ar') || route.startsWith('/en') ? route : `/ar${route === '/' ? '' : route}`;
      const result = { route, finalPath, expected, status: response.status(), redirectChain, errors, warnings, failures,
        lang: await page.locator('html').getAttribute('lang'), dir: await page.locator('html').getAttribute('dir') };
      results.push(result);
      console.log(JSON.stringify(result));
      page.off('pageerror', onError); page.off('console', onConsole); page.off('response', onResponse);
      assert.equal(finalPath, expected);
      assert.equal(response.status(), 200);
      assert.equal(result.lang, locale);
      assert.equal(result.dir, locale === 'ar' ? 'rtl' : 'ltr');
      assert.equal(errors.length, 0, errors.join('\n'));
      assert.equal(failures.length, 0, JSON.stringify(failures));
    }
    assert.ok(results.every(result => result.redirectChain.length <= 8), 'excessive redirect chain; see per-route report');
  } finally {
    if (process.env.TEST_REPORT) fs.writeFileSync(process.env.TEST_REPORT, JSON.stringify(results, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
