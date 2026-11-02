// 在服务器浏览器中验证 DSH 入口和同一个 noVNC 桌面；不输出 bootstrap token。
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const authFile = process.env.DSH_DESKTOP_TEST_AUTH_FILE;
if (process.env.DSH_DESKTOP_ISOLATED_TEST !== '1' && !authFile) throw new Error('必须明确指定隔离实例或受保护的只读界面验收凭据文件');
const runtime = createRequire('/opt/dsh-camoufox/package.json');
const { chromium } = runtime('playwright-core');
const auth = authFile ? JSON.parse(readFileSync(authFile, 'utf8')) : undefined;
const bootstrap = auth?.url || readFileSync('/tmp/dsh-desktop/test-bootstrap-url', 'utf8').trim();
const output = '/workspace/desktop-acceptance';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
let page;
try {
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1600, height: 1100 }, ...(auth ? { httpCredentials: { username: auth.username, password: auth.password } } : {}) });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(bootstrap, { waitUntil: 'domcontentloaded' });
  const entry = page.getByRole('button', { name: '打开桌面并人工接管', exact: true });
  await entry.waitFor({ timeout: 30000 });
  const preview = page.getByRole('button', { name: '继续', exact: true });
  await preview.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await preview.isVisible()) await preview.click();
  const onboarding = page.getByRole('presentation').filter({ hasText: '登录 DeepSeek 账号，或添加 API Key' });
  await onboarding.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await onboarding.isVisible()) await onboarding.getByRole('button').first().click();
  assert.equal((await entry.innerText()).replace(/\s/g, ''), '🖥️桌面');
  await entry.click();
  const dialog = page.getByRole('dialog', { name: '桌面 · 人工接管', exact: true });
  await dialog.waitFor();
  const iframe = page.getByTitle('Linux 桌面', { exact: true });
  await iframe.waitFor();
  const desktop = await (await iframe.elementHandle()).contentFrame();
  assert(desktop, '桌面 iframe 未加载');
  await desktop.waitForFunction(() => document.documentElement.classList.contains('noVNC_connected'), null, { timeout: 30000 });
  await desktop.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas || canvas.width < 1000 || canvas.height < 700) return false;
    const ctx = canvas.getContext('2d');
    const colors = new Set();
    for (let y = 20; y < canvas.height; y += 40) for (let x = 20; x < canvas.width; x += 40) colors.add(Array.from(ctx.getImageData(x, y, 1, 1).data).join(','));
    return colors.size > 10;
  }, null, { timeout: 30000 });
  await page.screenshot({ path: `${output}/dsh-desktop.png`, fullPage: true });
  const canvas = desktop.locator('canvas').first();
  await canvas.screenshot({ path: `${output}/linux-desktop.png` });
  assert.deepEqual(errors, []);
  const report = { status: 'passed', sidebarLabel: '桌面', dialogTitle: '桌面 · 人工接管', novncConnected: true, canvas: await canvas.evaluate(element => ({ width: element.width, height: element.height })), frontendErrors: errors };
  writeFileSync(`${output}/ui-acceptance.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  if (page) await page.screenshot({ path: `${output}/ui-failed.png`, fullPage: true }).catch(() => {});
  if (page) writeFileSync(`${output}/ui-failed.json`, JSON.stringify({ text: await page.locator('body').innerText(), buttons: await page.getByRole('button').allTextContents() }, null, 2));
  throw error;
} finally { await browser.close(); }
