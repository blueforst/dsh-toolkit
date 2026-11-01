import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createConnection } from '@playwright/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest, ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { launch } from './launch.mjs';
import { BrowserLifecycle } from './lifecycle.mjs';

const execute = promisify(execFile);
const sessions = new Map();
const records = new Set();
const config = {
  browser: { browserName: 'firefox', contextOptions: { viewport: null } },
  capabilities: ['core', 'vision'],
  timeouts: { action: 15000, navigation: 45000 },
  outputDir: '/workspace/browser-artifacts',
};
const lifecycle = new BrowserLifecycle({
  launch: () => launch('/home/node/.dsh/camoufox'),
  idleTimeoutMs: Number(process.env.DSH_BROWSER_IDLE_TIMEOUT_MS ?? 1800000),
  readDesktopIdle: async () => Number((await execute('python3', [new URL('./desktop-idle.py', import.meta.url).pathname], { timeout: 2000 })).stdout.trim()),
  retire: async () => { await Promise.all([...records].map(record => resetBackend(record))); },
});
lifecycle.on('started', () => console.log('Camoufox 已按需启动'));
lifecycle.on('released', reason => console.log(`Camoufox 已释放：${reason}`));
lifecycle.on('fault', error => console.error('Camoufox 生命周期错误：', error.message));

// 外层 MCP 会话保持有效；回收时丢弃绑定旧 BrowserContext 的内层 Playwright backend。
async function backend(record) {
  if (!record.backend) {
    record.backend = (async () => {
      const connection = await createConnection(config, () => lifecycle.ensure());
      const client = new Client({ name: 'dsh-camoufox-backend', version: '1.1.0' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await connection.connect(serverTransport);
      try { await client.connect(clientTransport); }
      catch (error) { await connection.close(); throw error; }
      return { client, connection };
    })().catch(error => { record.backend = null; throw error; });
  }
  return record.backend;
}
async function resetBackend(record) {
  const pending = record.backend;
  record.backend = null;
  if (!pending) return;
  const current = await pending.catch(() => null);
  if (current) await Promise.allSettled([current.client.close(), current.connection.close()]);
}
async function createSession() {
  const record = { backend: null };
  const connection = new Server({ name: 'camoufox-playwright', version: '1.1.0' }, {
    capabilities: { tools: {} },
    instructions: '浏览器按需启动，闲置三十分钟自动释放。完成整项浏览器任务后请调用 browser_close 释放浏览器；后续调用会自动重启，登录数据保留。',
  });
  connection.setRequestHandler(ListToolsRequestSchema, async () => {
    const result = await (await backend(record)).client.listTools();
    return { ...result, tools: result.tools.map(tool => tool.name === 'browser_close'
      ? { ...tool, description: '完成整项浏览器任务后调用：关闭全部标签页并释放共享浏览器进程，保留登录数据。后续浏览器调用会自动重启。' } : tool) };
  });
  connection.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (request.params.name === 'browser_close') {
      const closed = await lifecycle.close('tool');
      return { content: [{ type: 'text', text: closed ? '浏览器已释放，登录数据保留；后续调用会自动重启。' : '当前操作或下载结束后将释放浏览器。' }] };
    }
    return lifecycle.run(async () => (await backend(record)).client.callTool(request.params, undefined, { timeout: 120000, signal: extra.signal }));
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    onsessioninitialized: id => sessions.set(id, record),
  });
  record.transport = transport;
  record.connection = connection;
  connection.onclose = () => {
    sessions.delete(transport.sessionId);
    records.delete(record);
    resetBackend(record).catch(error => console.error(error.message));
  };
  records.add(record);
  await connection.connect(transport);
  return record;
}

const ids = new WeakMap();
function pageId(page) {
  if (!ids.has(page)) ids.set(page, randomUUID());
  return ids.get(page);
}
function json(res, code, value) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function readBody(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 1024 * 1024) throw new Error('请求体过大');
  }
  return data ? JSON.parse(data) : undefined;
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:9222');
    if (url.pathname === '/health' || url.pathname === '/json/version') {
      return json(res, 200, { browser: 'Camoufox', version: lifecycle.context?.browser()?.version(), persistent: true,
        protocol: 'Playwright', ...lifecycle.status(), sessions: sessions.size });
    }
    if (url.pathname === '/json/list') {
      // 桌面会定期轮询，不能因此创建浏览器或重置闲置时间。
      return json(res, 200, await Promise.all((lifecycle.context?.pages() ?? []).map(async page => ({
        id: pageId(page), url: page.url(), title: await page.title().catch(() => ''),
      }))));
    }
    if (url.pathname === '/json/new' && req.method === 'PUT') {
      const target = new URL(decodeURIComponent(req.url.slice(req.url.indexOf('?') + 1)));
      if (!['http:', 'https:'].includes(target.protocol)) return json(res, 400, { error: '仅允许 HTTP/HTTPS' });
      return json(res, 200, await lifecycle.run(async context => {
        const page = await context.newPage();
        try { await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 45000 }); }
        catch (error) { await page.close().catch(() => {}); throw error; }
        await page.bringToFront();
        return { id: pageId(page), url: page.url(), type: 'page' };
      }));
    }
    if (url.pathname.startsWith('/json/activate/') && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.split('/').pop());
      const page = lifecycle.context?.pages().find(page => pageId(page) === id);
      if (!page) return json(res, 404, { error: '标签页不存在' });
      await lifecycle.run(() => page.bringToFront());
      return json(res, 200, { status: 'activated' });
    }
    if (url.pathname === '/mcp') {
      const id = req.headers['mcp-session-id'];
      let record = id ? sessions.get(id) : undefined;
      const body = req.method === 'POST' ? await readBody(req) : undefined;
      if (!record && req.method === 'POST' && !id && isInitializeRequest(body)) record = await createSession();
      if (!record) return json(res, id ? 404 : 400, { error: 'MCP 会话无效' });
      return await record.transport.handleRequest(req, res, body);
    }
    json(res, 404, { error: '接口不存在' });
  } catch (error) {
    console.error(error.message);
    if (!res.headersSent) json(res, 500, { error: error.message });
    else res.end();
  }
});
server.listen(9222, '127.0.0.1', () => console.log('Camoufox 按需浏览器及 Playwright MCP 已就绪'));
let idleErrorLogged = false;
const timer = setInterval(() => lifecycle.checkIdle().then(() => { idleErrorLogged = false; }).catch(error => {
  // 无法确认桌面是否正在使用时，暂缓自动回收。
  if (!idleErrorLogged) console.error('暂缓浏览器闲置回收：', error.message);
  idleErrorLogged = true;
}), Math.min(2000, lifecycle.idleTimeoutMs / 4));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  server.close();
  await Promise.allSettled([...records].map(record => record.connection.close()));
  await lifecycle.stop();
  process.exit(0);
}
process.on('SIGTERM', () => stop().catch(() => process.exit(1)));
process.on('SIGINT', () => stop().catch(() => process.exit(1)));
