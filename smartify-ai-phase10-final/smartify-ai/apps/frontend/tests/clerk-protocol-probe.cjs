// Read-only browser/network comparison. Never saves cookie/token values.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');

function safeUrl(raw, base) {
  if (!raw) return null;
  const url = new URL(raw, base);
  for (const [key, value] of url.searchParams) {
    url.searchParams.set(key, /redirect_url|return_back_url/.test(key) && /^https?:/.test(value)
      ? safeUrl(value) : '[REDACTED]');
  }
  return url.toString();
}
function cookieMetadata(line, responseUrl) {
  const [pair, ...attributes] = line.split(';').map(x => x.trim());
  const parsed = Object.fromEntries(attributes.map(x => {
    const index = x.indexOf('=');
    return index < 0 ? [x.toLowerCase(), true] : [x.slice(0, index).toLowerCase(), x.slice(index + 1)];
  }));
  return { name: pair.slice(0, pair.indexOf('=')), sameSite: parsed.samesite || 'unspecified',
    secure: parsed.secure === true, httpOnly: parsed.httponly === true,
    domain: parsed.domain || new URL(responseUrl).hostname, hostOnly: !parsed.domain,
    path: parsed.path || '/', expires: parsed.expires, maxAge: parsed['max-age'] };
}

async function probe(base) {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext(); // TLS validation remains enabled.
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const report = { base, versions: { next: '15.5.21', clerk: '5.7.6' }, tlsVerification: true,
    navigation: [], setCookies: [], rejectedCookies: [], console: [], runtimeErrors: [], requestsFailed: [] };
  const requests = new Map();
  const pending = [];
  await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent', event => requests.set(event.requestId, safeUrl(event.request.url)));
  cdp.on('Network.responseReceivedExtraInfo', event => {
    for (const cookie of event.blockedCookies || []) report.rejectedCookies.push({
      response: requests.get(event.requestId), ...cookieMetadata(cookie.cookieLine, requests.get(event.requestId) || base),
      reasons: cookie.blockedReasons,
    });
  });
  page.on('console', message => {
    if (['warning', 'error'].includes(message.type())) report.console.push({ type: message.type(), text: message.text() });
  });
  page.on('pageerror', error => report.runtimeErrors.push(error.message));
  page.on('requestfailed', request => report.requestsFailed.push({ url: safeUrl(request.url()), error: request.failure()?.errorText }));
  page.on('response', response => pending.push((async () => {
    const headers = await response.allHeaders();
    const location = safeUrl(headers.location, response.url());
    if (response.request().isNavigationRequest()) report.navigation.push({
      url: safeUrl(response.url()), status: response.status(), location,
      authStatus: headers['x-clerk-auth-status'], authReason: headers['x-clerk-auth-reason'],
      origin: new URL(response.url()).hostname.endsWith('.clerk.accounts.dev') ? 'Clerk Frontend API'
        : headers['x-clerk-auth-status'] === 'handshake' || /__clerk_handshake/.test(response.url()) ? 'Clerk SDK middleware handshake'
          : location ? 'Smartify locale/protection middleware' : 'Next page',
    });
    for (const cookie of headers['set-cookie']?.split('\n') || []) report.setCookies.push({
      response: safeUrl(response.url()), status: response.status(), ...cookieMetadata(cookie, response.url()),
    });
  })()));
  try {
    await page.goto(base + '/', { waitUntil: 'networkidle', timeout: 30000 });
    report.finalUrl = safeUrl(page.url());
    report.clerkLoaded = await page.evaluate(() => Boolean(window.Clerk?.loaded));
    report.cookies = (await context.cookies()).map(({ name, domain, path, secure, httpOnly, sameSite }) => ({ name, domain, path, secure, httpOnly, sameSite }));
    await page.goto(base + '/en/onboarding/profile', { waitUntil: 'networkidle', timeout: 30000 });
    report.signedOutProtectedDestination = safeUrl(page.url());
  } catch (error) { report.failure = error.message; }
  finally { await Promise.allSettled(pending); await browser.close(); }
  return report;
}
(async () => {
  const reports = [];
  for (const base of process.argv.slice(2)) reports.push(await probe(base));
  fs.writeFileSync(process.env.TEST_REPORT, JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports.map(r => ({ base: r.base, failure: r.failure,
    finalUrl: r.finalUrl, navigationCount: r.navigation.length,
    rejectedCookies: r.rejectedCookies.map(c => ({ name: c.name, reasons: c.reasons })),
    signedOutProtectedDestination: r.signedOutProtectedDestination, runtimeErrors: r.runtimeErrors }))));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
