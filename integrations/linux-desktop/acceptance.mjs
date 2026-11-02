// 在独立测试容器执行：docker exec -i -e DSH_DESKTOP_ISOLATED_TEST=1 CONTAINER node --input-type=module < 本文件
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

if (process.env.DSH_DESKTOP_ISOLATED_TEST !== '1') throw new Error('仅允许在明确指定的隔离桌面中执行');
Object.assign(process.env, {
  DISPLAY: ':99', XDG_RUNTIME_DIR: '/tmp/dsh-runtime',
  DBUS_SESSION_BUS_ADDRESS: readFileSync('/tmp/dsh-desktop/session-bus-address', 'utf8'),
});
const runtime = createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json');
const load = name => import(pathToFileURL(runtime.resolve(name)).href);
const { Context } = await load('@deepseek-ai/cordis');
const { default: ComputerUse } = await load('@deepseek-ai/dsh-computer-use');
const { default: SystemPrompt } = await load('@deepseek-ai/dsh-system-prompt');
const { default: ToolRuntime } = await load('@deepseek-ai/dsh-tools');
const NativeToolExecutor = await load('@deepseek-ai/dsh-tool-executor-native');
const Provider = await import('/opt/dsh-linux-desktop/provider/lib/index.js');
const output = '/workspace/desktop-acceptance';
mkdirSync(output, { recursive: true });
const vision = process.env.DSH_DESKTOP_VISION_TEST === '1';
const filename = `dsh-cua-${vision ? 'vision' : 'acceptance'}-${process.pid}.txt`;
const file = `${output}/${filename}`;
const marker = vision ? 'DSH_VISION_ONLY_CUA_OK' : 'DSH_LINUX_DESKTOP_CUA_OK';
const ctx = new Context();
const report = {};
let sequence = 0;
let editorPid;
let visionPoint;
async function call(name, args = {}) {
  const batch = await ctx.tools.execute({
    calls: [{ type: 'tool-call', id: `desktop-${++sequence}`, name: `mcp__cua-driver-mcp__${name}`, arguments: JSON.stringify(args) }],
    signal: AbortSignal.timeout(90000),
  });
  const result = batch.results[0].result;
  assert(!result.isError, JSON.stringify(result));
  assert(result.value && Array.isArray(result.value.content), `缺少规范 MCP 结果：${name}`);
  return result.value;
}
function data(result) { return result.structuredContent; }
function saveImage(result, filename) {
  const image = result.content.find(block => block.type === 'image');
  assert(image, '缺少真实截图');
  writeFileSync(`${output}/${filename}`, Buffer.from(image.data, 'base64'));
}
try {
  await ctx.plugin(ComputerUse);
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(NativeToolExecutor);
  const provider = await ctx.plugin(Provider, { command: '/usr/local/bin/cua-driver', args: ['mcp', '--direct'], reconnect: { enabled: false } });
  assert.equal(ctx.computerUse.providerName, 'cua-driver-mcp');
  const tools = ctx.tools.schemas();
  assert(tools.some(tool => tool.name === 'mcp__cua-driver-mcp__get_window_state'));
  report.officialDshProvider = true;
  report.toolCount = tools.length;
  const permissions = data(await call('check_permissions', { prompt: false }));
  assert(permissions.x11 && permissions.atspi, JSON.stringify(permissions));
  report.x11 = permissions.x11;
  report.atspi = permissions.atspi;
  writeFileSync(file, '');
  const initial = await (await fetch('http://127.0.0.1:9222/health')).json();
  assert.equal(initial.running, false, '隔离实例应从没有浏览器的状态开始');
  await call('launch_app', { launch_path: '/usr/bin/mousepad', additional_arguments: [file] });
  let window;
  for (let i = 0; i < 40; i++) {
    const windows = data(await call('list_windows'))?.windows || [];
    window = windows.find(item => String(item.title).includes(filename));
    if (window) break;
    // 专用验收容器上次被终止时，Mousepad 可能先显示恢复询问。
    const recovery = windows.find(item => item.title === 'Mousepad');
    if (recovery && !vision) {
      const state = data(await call('get_window_state', { pid: recovery.pid, window_id: recovery.window_id, include_screenshot: false }));
      if (JSON.stringify(state).includes('previous session')) {
        const no = state.elements?.find(element => Object.values(element).includes('No'));
        assert(no?.element_token, '恢复询问缺少可定位的 No 按钮');
        await call('click', { pid: recovery.pid, window_id: recovery.window_id, element_token: no.element_token });
      }
    }
    await sleep(250);
  }
  assert(window, '未发现验收编辑器窗口');
  editorPid = window.pid;
  const target = { pid: window.pid, window_id: window.window_id };
  const before = await call('get_window_state', { ...target, include_screenshot: true, include_accessibility_tree: !vision });
  const imagePrefix = vision ? 'vision' : 'editor';
  saveImage(before, `${imagePrefix}-before.png`);
  report.mode = vision ? 'screenshot-coordinates' : 'accessibility-and-screenshot';
  if (vision) {
    // 已核对的 Mousepad 截图中，窗口中央是空白编辑区。只用截图尺寸定位，不读取元素树。
    const { screenshot_width: width, screenshot_height: height } = data(before);
    assert(width >= 400 && height >= 300, '截图尺寸不足以定位编辑区');
    const point = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
    visionPoint = point;
    await call('click', { ...target, ...point, delivery_mode: 'foreground' });
    report.coordinateClick = point;
    report.accessibilityUsedForTargeting = false;
  } else {
    report.accessibleElements = data(before)?.elements?.length || 0;
    assert(report.accessibleElements > 0, '编辑器无障碍树为空');
  }
  await call('type_text', { ...target, ...(visionPoint || {}), delivery_mode: 'foreground', text: marker });
  const after = await call('get_window_state', { ...target, include_screenshot: true, include_accessibility_tree: !vision });
  saveImage(after, `${imagePrefix}-after.png`);
  if (!vision) assert(JSON.stringify(data(after)).includes(marker), '输入后的独立无障碍快照未读到验收文字');
  await call('press_key', { ...target, ...(visionPoint || {}), delivery_mode: 'foreground', key: 's', modifiers: ['ctrl'] });
  for (let i = 0; i < 30 && readFileSync(file, 'utf8').trim() !== marker; i++) await sleep(200);
  assert.equal(readFileSync(file, 'utf8').trim(), marker, '保存后的文件内容不一致');
  report.textInputReadback = !vision;
  report.savedFileReadback = true;
  report.savedFile = filename;
  const browser = await (await fetch('http://127.0.0.1:9222/health')).json();
  assert.equal(browser.running, false, '编辑器输入不应唤醒浏览器');
  report.desktopInputDoesNotWakeBrowser = true;
  report.screenshots = [`${imagePrefix}-before.png`, `${imagePrefix}-after.png`];
  await call('press_key', { ...target, delivery_mode: 'foreground', key: 'q', modifiers: ['ctrl'] });
  editorPid = undefined;
  await provider.dispose();
  assert.equal(ctx.computerUse.providerName, undefined);
  assert.equal(ctx.tools.schemas().length, 0);
  report.providerReleased = true;
  report.status = 'passed';
  writeFileSync(`${output}/${vision ? 'vision-acceptance' : 'acceptance'}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  if (editorPid && ctx.tools.get('mcp__cua-driver-mcp__kill_app')) await call('kill_app', { pid: editorPid }).catch(() => {});
  await ctx.fiber.dispose();
}
