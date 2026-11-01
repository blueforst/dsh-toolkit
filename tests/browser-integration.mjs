// 只在独立测试容器中执行，不连接生产浏览器或外部网站。
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
if (process.env.CAMOUFOX_ISOLATED_TEST !== '1') throw new Error('必须显式指定独立测试环境');
const runtime = createRequire('/opt/dsh-camoufox/package.json');
const load = name => import(pathToFileURL(runtime.resolve(name)).href);
const { Client } = await load('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = await load('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { StdioClientTransport } = await load('@modelcontextprotocol/sdk/client/stdio.js');
const execute = promisify(execFile);
const base = 'http://127.0.0.1:9222';
const health = () => fetch(base + '/health').then(r => r.json());
const processCount = () => readdirSync('/proc').filter(name => /^\d+$/.test(name)).filter(pid => {
  try { return readFileSync(`/proc/${pid}/comm`, 'utf8').trim() === 'camoufox-bin'; } catch { return false; }
}).length;
const report = {};
async function until(check, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await check()) return;
    await sleep(300);
  }
  throw new Error('等待条件超时：' + JSON.stringify(await health()));
}
const site = http.createServer((req, res) => {
  if (req.url === '/download') {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="idle-test.txt"' });
    res.write('start\n');
    setTimeout(() => res.end('done\n'), 7000);
  } else {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><title>闲置回收测试</title><a href="/download">download</a><p>isolated</p></html>');
  }
});
await new Promise(resolve => site.listen(9223, '127.0.0.1', resolve));
const client = new Client({ name: 'idle-acceptance', version: '1' });
const transport = new StreamableHTTPClientTransport(new URL(base + '/mcp'));
try {
  await until(async () => { try { return (await health()).idleTimeoutMs === 3000; } catch { return false; } });
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  const run = tools.find(tool => tool.name.includes('run_code'))?.name;
  assert.ok(run, '运行代码工具存在');
  const call = async code => {
    const result = await client.callTool({ name: run, arguments: { code } }, undefined, { timeout: 120000 });
    assert.ok(!result.isError, JSON.stringify(result));
    return result;
  };
  assert.equal((await health()).running, false);
  assert.equal(processCount(), 0);
  report.lazyStartup = true;
  await call("async (page) => { await page.goto('http://127.0.0.1:9223'); await page.context().addCookies([{ name: 'persist', value: 'yes', url: 'http://127.0.0.1:9223', expires: Math.floor(Date.now()/1000)+3600 }]); await page.context().newPage(); return 'ready'; }");
  const preset = readFileSync('/home/node/.dsh/camoufox/device-preset.json', 'utf8');
  assert.ok((await health()).pages >= 2);
  await until(async () => {
    await fetch(base + '/json/list'); // 持续轮询也必须回收。
    return !(await health()).running && processCount() === 0;
  });
  report.idleReleaseDespitePolling = true;
  const firstGeneration = (await health()).generation;
  const restored = await call("async (page) => { await page.goto('http://127.0.0.1:9223'); return { cookie: await page.evaluate(() => document.cookie), pages: page.context().pages().length }; }");
  assert.match(JSON.stringify(restored), /persist=yes/);
  assert.equal(readFileSync('/home/node/.dsh/camoufox/device-preset.json', 'utf8'), preset);
  assert.equal((await health()).generation, firstGeneration + 1);
  assert.equal((await health()).pages, 1);
  report.sameMcpSessionCookieAndPreset = true;
  await client.callTool({ name: 'browser_close', arguments: {} });
  await until(async () => !(await health()).running && processCount() === 0);
  report.explicitClose = true;
  const long = call('async (page) => { await page.waitForTimeout(7000); return "long done"; }');
  await until(async () => (await health()).active > 0);
  await sleep(4000);
  assert.equal((await health()).running, true);
  await long;
  report.longToolProtected = true;
  await call("async (page) => { await page.goto('http://127.0.0.1:9223'); const download = page.waitForEvent('download'); await page.getByRole('link', {name: 'download'}).click(); await download; return 'downloading'; }");
  await sleep(4000);
  assert.equal((await health()).running, true);
  assert.ok((await health()).active > 0);
  await until(async () => !(await health()).running && processCount() === 0);
  report.downloadProtected = true;
  let input = 0;
  async function desktopInput() {
    await execute('python3', ['-c', `import ctypes as c
x=c.CDLL('libX11.so.6'); t=c.CDLL('libXtst.so.6')
x.XOpenDisplay.argtypes=[c.c_char_p]; x.XOpenDisplay.restype=c.c_void_p
x.XFlush.argtypes=[c.c_void_p]; x.XCloseDisplay.argtypes=[c.c_void_p]
t.XTestFakeMotionEvent.argtypes=[c.c_void_p,c.c_int,c.c_int,c.c_int,c.c_ulong]
d=x.XOpenDisplay(b':99'); assert d
t.XTestFakeMotionEvent(d,-1,${100 + ++input},100,0); x.XFlush(d); x.XCloseDisplay(d)`]);
  }
  await desktopInput();
  await until(async () => (await health()).running);
  const untilTime = Date.now() + 5000;
  while (Date.now() < untilTime) { await desktopInput(); await sleep(700); }
  assert.equal((await health()).running, true);
  report.desktopInputWakesAndProtects = true;
  await until(async () => !(await health()).running && processCount() === 0);
  await transport.terminateSession();
  await client.close();
  await until(async () => (await health()).sessions === 0);
  const stdioClient = new Client({ name: 'stdio-cleanup', version: '1' });
  await stdioClient.connect(new StdioClientTransport({ command: process.execPath, args: ['/opt/dsh-camoufox/mcp-proxy.mjs'] }));
  await stdioClient.listTools();
  assert.equal((await health()).sessions, 1);
  assert.equal((await health()).running, false);
  await stdioClient.close();
  await until(async () => (await health()).sessions === 0);
  report.stdioTerminationDeletesSession = true;
  report.final = await health();
  report.browserProcesses = processCount();
  console.log(JSON.stringify(report, null, 2));
} finally {
  await transport.terminateSession().catch(() => {});
  await client.close().catch(() => {});
  site.closeAllConnections();
  site.close();
}
