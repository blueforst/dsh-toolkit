// 在服务器浏览器执行；真实模型调用必须额外显式启用。
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
const authFile = process.env.DSH_AVATAR_TEST_AUTH_FILE;
if (!authFile) throw new Error('需要受保护的界面验收凭据文件');
const auth = JSON.parse(readFileSync(authFile, 'utf8'));
const output = process.env.DSH_AVATAR_TEST_OUTPUT || '/workspace/avatar-acceptance';
mkdirSync(output, { recursive: true });
const { chromium } = createRequire('/opt/dsh-camoufox/package.json')('playwright-core');
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ locale: 'zh-CN', ignoreHTTPSErrors: true, viewport: { width: 1180, height: 1000 }, httpCredentials: { username: auth.username, password: auth.password } });
const page = await context.newPage(), errors = [], observed = [];
page.on('pageerror', error => errors.push(error.message));
let timer;
try {
  await page.goto(auth.url, { waitUntil: 'domcontentloaded' });
  const proceed = page.getByRole('button', { name: '继续', exact: true });
  await proceed.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  if (await proceed.isVisible()) await proceed.click();
  const onboarding = page.getByRole('presentation').filter({ hasText: '登录 DeepSeek 账号，或添加 API Key' });
  if (await onboarding.isVisible()) await onboarding.getByRole('button').first().click();
  const origin = new URL(auth.url).origin;
  assert.equal((await page.goto(origin + '/avatar/', { waitUntil: 'domcontentloaded' })).status(), 200);
  await page.waitForFunction(() => typeof ready !== 'undefined' && ready, null, { timeout: 15000 });
  assert.equal(await page.locator('#controls button').count(), 8);
  await page.getByRole('button', { name: '思考中', exact: true }).click();
  await sleep(600);
  await page.screenshot({ path: output + '/avatar-preview.png', fullPage: true });
  assert.equal((await context.request.get(origin + '/avatar/api/state')).status(), 200);
  const report = { preview: true, preparedFrames: await page.evaluate(() => Object.keys(images).length), controls: 8, realModelTest: false };
  if (await page.locator('#recording').isVisible()) {
    const partial = await context.request.get(origin + '/avatar/preview.mp4', { headers: { Range: 'bytes=0-31' } });
    assert.equal(partial.status(), 206);
    assert.equal((await partial.body()).length, 32);
    assert((await partial.body()).includes(Buffer.from('ftyp')));
    await page.waitForFunction(() => document.querySelector('video').videoWidth === 1920, null, { timeout: 15000 });
    report.recording = await page.locator('video').evaluate(video => ({ width: video.videoWidth, height: video.videoHeight, seconds: video.duration, rangeStatus: 206 }));
  }
  if (process.env.DSH_AVATAR_LIVE_MODEL_TEST === '1') {
    const config = JSON.parse(readFileSync('/home/node/.dsh/avatar/config.json', 'utf8'));
    const token = readFileSync(config.tokenFile, 'utf8').trim();
    await fetch(new URL('/api/action', config.url), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'idle', source: 'manual', ttl: .25 }) });
    const sample = async () => {
      try {
        const value = await (await fetch(new URL('/api/state', config.url), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000) })).json();
        if (observed.at(-1)?.phase !== value.phase || observed.at(-1)?.action !== value.action) observed.push({ timestamp: Date.now(), action: value.action, phase: value.phase, source: value.source });
      } catch {}
    };
    await page.goto(auth.url, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '新建会话', exact: true }).first().click();
    const editor = page.locator('[contenteditable="true"][role="textbox"]');
    await editor.fill('这是一次角色联动验收。请调用 avatar_set_action 将角色设为 wave，持续 3 秒，然后只回复“角色联动验收完成”。不要调用其他工具。');
    timer = setInterval(sample, 100);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.locator('p:visible').filter({ hasText: /^角色联动验收完成[。！]?$/ }).last().waitFor({ timeout: 120000 });
    await sleep(3500); clearInterval(timer); timer = undefined; await sample();
    assert(observed.some(x => x.action === 'thinking' && x.source === 'auto'));
    assert(observed.some(x => x.action === 'wave' && x.source === 'manual'));
    assert.equal(observed.at(-1).action, 'idle');
    report.realModelTest = true; report.thinkingAutomatic = true; report.agentInvokedActionTool = true; report.returnedToIdle = true;
    await page.goto(origin + '/avatar/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof ready !== 'undefined' && ready);
    await page.screenshot({ path: output + '/avatar-after-agent.png', fullPage: true });
  }
  assert.deepEqual(errors, []);
  writeFileSync(output + '/ui-acceptance.json', JSON.stringify({ ...report, observed, frontendErrors: errors }, null, 2));
  console.log(JSON.stringify({ ...report, observed, frontendErrors: errors }));
} catch (error) {
  writeFileSync(output + '/ui-failed.json', JSON.stringify({ message: error.message, observed, frontendErrors: errors }, null, 2));
  await page.screenshot({ path: output + '/ui-failed.png', fullPage: true }).catch(() => {});
  throw new Error(String(error.message).replaceAll(auth.password, '[已隐藏]'));
} finally {
  clearInterval(timer);
  await browser.close();
  unlinkSync(authFile);
}
