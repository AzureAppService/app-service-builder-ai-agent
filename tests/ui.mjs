import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.SAMPLE_URL || 'http://127.0.0.1:8120';
assert.equal(new URL(url).hostname, '127.0.0.1', 'Use the unconfigured local app only');
const browser = await chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.goto(url);
  await page.locator('#setup-status').filter({ hasText: /missing/ }).waitFor();
  assert.equal(await page.locator('input').count(), 0);
  assert.equal((await page.request.get(`${url}/ready`)).status(), 503);
  await page.locator('[data-health-check]').click();
  await page.locator('#health-status').filter({ hasText: 'Healthy:' }).waitFor();
  await page.route('**/api/setup', route => route.abort());
  await page.locator('#setup-check').click();
  await page.locator('#setup-status').filter({ hasText: 'could not be read' }).waitFor();
  assert.equal(await page.locator('#setup-check').isEnabled(), true);
  await page.unroute('**/api/setup');
  await page.locator('#setup-check').click();
  await page.locator('#setup-status').filter({ hasText: /missing/ }).waitFor();
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/desktop1440.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('link', { name: /Create and connect your model/ }).focus();
  await page.keyboard.press('Enter');
  await page.locator('#setup').waitFor();
  assert.equal(await page.locator('h2').count(), 6, 'Reader renders numbered setup steps, not a raw Markdown wall');
  assert.ok((await page.locator('pre code').allTextContents()).every(code => !/\\\n\n/.test(code)), 'Reader preserves shell continuations');
  assert.match(await page.locator('body').textContent(), /Model deployments/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.goBack();
  await page.locator('#setup-status').filter({ hasText: /missing/ }).waitFor();
  await page.getByRole('link', { name: /Configure your own app/ }).click();
  assert.equal(await page.locator('#customize').getAttribute('open'), '');
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/mobile390.png`, fullPage: true });
  assert.equal(await page.locator('a[download]').count(), 0);
  assert.ok(requests.every(request => new URL(request).hostname === '127.0.0.1'));
  assert.ok(requests.every(request => !new URL(request).pathname.startsWith('/agent')));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ sample: 'ai-agent', substrate: 'real local unconfigured app', desktop: 1440, mobile: 390,
    setupRetry: 'passed', keyboardSetupNavigation: 'passed', readiness: 503, providerRequests: 0, cloudVerified: false }));
} finally {
  await browser.close();
}
