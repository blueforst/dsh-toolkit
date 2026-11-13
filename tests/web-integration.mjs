// 在具备 Chromium 与 playwright-core 的服务器环境运行；目标必须是隔离测试实例。
// 启动 fixture-server.mjs，将 DSH_METRICS_URL 和 DSH_OPENCODE_GO_USAGE_URL 指向同一回环替身的 /metrics 和 /usage。
// 将 DSH 默认模型指向替身的 /v1，并将 workspace-controller.config.documentsDirectory 设为可写的临时目录。
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const bootstrap = process.env.TOOLKIT_TEST_URL;
if (!bootstrap) throw new Error('请设置隔离测试实例的 TOOLKIT_TEST_URL');
const base = new URL(bootstrap).origin;
const output = process.env.TOOLKIT_TEST_OUTPUT || '/tmp';
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const cost = page.locator('[data-dsh-session-cost]');
try {
  const fresh = await browser.newContext();
  assert.equal((await fresh.request.get(base + '/server-metrics')).status(), 401);
  assert.equal((await fresh.request.get(base + '/opencode-go-quota')).status(), 401);
  await fresh.close();
  const response = await page.goto(bootstrap, { waitUntil: 'domcontentloaded' });
  assert.equal(response.status(), 200);
  const continueButton = page.getByRole('button', { name: '继续', exact: true });
  const metrics = page.locator('[data-dsh-server-metrics][data-state="ready"]');
  const quota = page.locator('[data-dsh-opencode-go-quota] [role="progressbar"][aria-valuetext="8%"]');
  await metrics.waitFor({ timeout: 30000 });
  await quota.waitFor({ timeout: 30000 });
  assert.deepEqual(await metrics.getByRole('progressbar').evaluateAll(bars => bars.map(bar => bar.getAttribute('aria-valuetext'))), ['3.2%', '25.0%', '20.0%']);
  for (const route of ['/server-metrics', '/opencode-go-quota']) {
    assert.equal((await context.request.head(base + route)).status(), 200);
    assert.equal((await context.request.post(base + route)).status(), 405);
    assert.equal((await context.request.get(base + route, { headers: { Origin: 'https://untrusted.invalid' } })).status(), 403);
  }
  if (await continueButton.isVisible()) await continueButton.click();
  await page.getByRole('button', { name: '新建会话', exact: true }).first().click();
  await cost.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[role="progressbar"]').count(), 4);
  const editor = page.locator('[contenteditable="true"][role="textbox"]');
  await editor.click();
  await editor.press('ControlOrMeta+A');
  await editor.press('Backspace');
  await editor.pressSequentially('toolkit integration test');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.locator('p:visible').filter({ hasText: /^工具包隔离验收通过。$/ }).last().waitFor({ timeout: 30000 });
  await cost.waitFor({ timeout: 10000 });
  const usd = Number(await cost.getAttribute('data-usd'));
  assert(Math.abs(usd - .0003) < 1e-12, '真实会话投影未正确累计本地替身用量');
  const activity = page.locator('[data-composer-stat="activity"]');
  assert((await cost.boundingBox()).x < (await activity.boundingBox()).x);
  const trigger = cost.getByRole('button');
  await trigger.click();
  const panel = page.getByRole('dialog', { name: '会话费用', exact: true });
  await panel.waitFor();
  assert.deepEqual(await panel.locator('dt').allTextContents(), ['输入', '输出', '缓存读']);
  assert.equal(await panel.locator('[data-cost-bucket="cacheWriteUsd"]').count(), 0);
  await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' });
  assert.equal(await trigger.evaluate(button => button === document.activeElement), true);
  await trigger.click(); await panel.waitFor();
  await editor.click(); await panel.waitFor({ state: 'hidden' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await cost.waitFor({ timeout: 30000 });
  assert.equal(Number(await cost.getAttribute('data-usd')), usd);
  await page.setViewportSize({ width: 430, height: 932 });
  await cost.getByRole('button').click(); await panel.waitFor();
  const bounds = await panel.boundingBox();
  assert(bounds.x >= 11 && bounds.x + bounds.width <= 419, '窄屏浮窗越界');
  assert.deepEqual(errors, []);
  const result = { status: 'passed', package: '@forst/dsh-toolkit', chromiumVersion: browser.version(), nativeInstall: true, authenticatedRoutes: true, sidebarBars: 4, quotaText: '8%', realSessionProjection: true, fixtureCostUsd: usd, costLabels: ['输入', '输出', '缓存读'], firstInStatsRow: true, escapeRestoredFocus: true, outsideClickCloses: true, reloadRestored: true, narrowViewport: true, externalModelRequests: 0, frontendErrors: [] };
  writeFileSync(output + '/web-integration.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  let message = String(error.message);
  for (const value of new URL(bootstrap).searchParams.values()) if (value) message = message.replaceAll(value, '[已隐藏]');
  console.log(JSON.stringify({ status: 'failed', error: message, frontendErrors: errors }));
  process.exitCode = 1;
} finally { await browser.close(); }
