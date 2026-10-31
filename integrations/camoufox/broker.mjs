import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createConnection } from '@playwright/mcp';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { launch } from './launch.mjs';

const context = await launch('/home/node/.dsh/camoufox');
context.on('close', () => process.exit(1));
if (!context.pages().length) await context.newPage();
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
const transports = new Map();
const connections = new Set();
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:9222');
    if (url.pathname === '/health' || url.pathname === '/json/version') {
      return json(res, 200, { browser: 'Camoufox', version: context.browser()?.version(), persistent: true, pages: context.pages().length, protocol: 'Playwright' });
    }
    if (url.pathname === '/json/list') {
      return json(res, 200, await Promise.all(context.pages().map(async page => ({ id: pageId(page), url: page.url(), title: await page.title() }))));
    }
    // 仅兼容桌面插件使用的打开/激活接口，不伪装 Chromium CDP。
    if (url.pathname === '/json/new' && req.method === 'PUT') {
      const target = new URL(decodeURIComponent(req.url.slice(req.url.indexOf('?') + 1)));
      if (!['http:', 'https:'].includes(target.protocol)) return json(res, 400, { error: '仅允许 HTTP/HTTPS' });
      const page = await context.newPage();
      await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.bringToFront();
      return json(res, 200, { id: pageId(page), url: page.url(), type: 'page' });
    }
    if (url.pathname.startsWith('/json/activate/') && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.split('/').pop());
      const page = context.pages().find(page => pageId(page) === id);
      if (!page) return json(res, 404, { error: '标签页不存在' });
      await page.bringToFront();
      return json(res, 200, { status: 'activated' });
    }
    if (url.pathname === '/mcp') {
      const id = req.headers['mcp-session-id'];
      let transport = id ? transports.get(id) : undefined;
      const body = req.method === 'POST' ? await readBody(req) : undefined;
      if (!transport && req.method === 'POST' && !id && isInitializeRequest(body)) {
        const connection = await createConnection({
          browser: { browserName: 'firefox', contextOptions: { viewport: null } },
          capabilities: ['core', 'vision'],
          timeouts: { action: 15000, navigation: 45000 },
          outputDir: '/workspace/browser-artifacts',
        }, async () => context);
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: sessionId => transports.set(sessionId, transport),
        });
        connections.add(connection);
        transport.onclose = () => {
          if (transport.sessionId) transports.delete(transport.sessionId);
          connections.delete(connection);
        };
        await connection.connect(transport);
      }
      if (!transport) return json(res, 400, { error: 'MCP 会话无效' });
      return await transport.handleRequest(req, res, body);
    }
    json(res, 404, { error: '接口不存在' });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, 500, { error: error.message });
    else res.end();
  }
});
server.listen(9222, '127.0.0.1', () => console.log('Camoufox 持久化浏览器及 Playwright MCP 已就绪'));
async function stop() {
  server.close();
  await Promise.allSettled([...connections].map(connection => connection.close()));
  await context.close();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
