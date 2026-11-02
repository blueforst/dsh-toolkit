// 验证完整桌面沿用原来的唯一浏览器、持久身份与显式释放。
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
if (process.env.DSH_DESKTOP_ISOLATED_TEST !== '1') throw new Error('仅允许明确指定的隔离实例');
const runtime = createRequire('/opt/dsh-camoufox/package.json');
const load = name => import(pathToFileURL(runtime.resolve(name)).href);
const { Client } = await load('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = await load('@modelcontextprotocol/sdk/client/streamableHttp.js');
const execute = promisify(execFile);
const health = () => fetch('http://127.0.0.1:9222/health', { headers: { Connection: 'close' } }).then(r => r.json());
const server = http.createServer((_req, res) => res.end('<title>桌面浏览器验收</title><p>DSH browser fixture</p>'));
await new Promise(resolve => server.listen(9223, '127.0.0.1', resolve));
const client = new Client({ name: 'desktop-browser-acceptance', version: '1' });
const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:9222/mcp'));
try {
  assert.equal((await health()).running, false);
  await execute('/opt/dsh-linux-desktop/open-browser.py');
  assert.equal((await health()).running, true);
  const preset = readFileSync('/home/node/.dsh/camoufox/device-preset.json', 'utf8');
  await client.connect(transport);
  const name = (await client.listTools()).tools.find(tool => tool.name.includes('run_code'))?.name;
  assert(name);
  const run = async code => {
    const result = await client.callTool({ name, arguments: { code } }, undefined, { timeout: 90000 });
    assert(!result.isError, JSON.stringify(result));
    return result;
  };
  await run("async page => { await page.goto('http://127.0.0.1:9223'); await page.context().addCookies([{name:'desktop-smoke',value:'persisted',url:'http://127.0.0.1:9223',expires:Math.floor(Date.now()/1000)+3600}]); return 'ready'; }");
  await client.callTool({ name: 'browser_close', arguments: {} });
  assert.equal((await health()).running, false);
  await execute('/opt/dsh-linux-desktop/open-browser.py');
  const restored = await run("async page => { await page.goto('http://127.0.0.1:9223'); return await page.evaluate(() => document.cookie); }");
  assert(JSON.stringify(restored).includes('desktop-smoke=persisted'));
  assert.equal(readFileSync('/home/node/.dsh/camoufox/device-preset.json', 'utf8'), preset);
  await client.callTool({ name: 'browser_close', arguments: {} });
  assert.equal((await health()).running, false);
  const report = { status: 'passed', shortcutOpensBrowser: true, browserUse: true, cookieAndPresetSurviveRelease: true, explicitClose: true, idleTimeoutMs: (await health()).idleTimeoutMs };
  writeFileSync('/workspace/desktop-acceptance/browser-smoke.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await transport.terminateSession().catch(() => {});
  await client.close();
  server.close();
}
