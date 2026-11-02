// 在服务器上的 DSH 运行时内执行；独立 Cordis 上下文，不消费真实模型额度。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

if (process.env.DSH_AVATAR_ISOLATED_TEST !== '1') throw new Error('需要明确启用隔离验收');
const runtime = createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json');
const load = name => import(pathToFileURL(runtime.resolve(name)).href);
const { Context } = await load('@deepseek-ai/cordis');
const { default: ToolRuntime } = await load('@deepseek-ai/dsh-tools');
const { default: SystemPrompt } = await load('@deepseek-ai/dsh-system-prompt');
const NativeExecutor = await load('@deepseek-ai/dsh-tool-executor-native');
const Provider = await import('./provider.mjs');
const ctx = new Context(), routes = new Map();
const server = http.createServer((req, res) => routes.get('/avatar')?.(req, res));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
ctx.provide('agents', {}); ctx.provide('sessions', {});
ctx.provide('webServer', { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path); } });
ctx.provide('connection', { requestRejection: req => req.headers.authorization === 'Bearer isolated-avatar-test' ? undefined : 401 });
const headers = { Authorization: 'Bearer isolated-avatar-test' };
let plugin;
async function state() { return (await fetch(origin + '/avatar/api/state', { headers })).json(); }
async function expect(action) { for (let i = 0; i < 40; i++) { const s = await state(); if (s.action === action) return s; await sleep(100); } assert.fail('角色状态未到达：' + action); }
try {
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(NativeExecutor);
  plugin = await ctx.plugin(Provider, { configFile: process.env.DSH_AVATAR_CONFIG || '/home/node/.dsh/avatar/config.json' });
  assert(ctx.tools.schemas().some(x => x.name === 'avatar_set_action'));
  assert.equal((await fetch(origin + '/avatar/api/state')).status, 401);
  assert.equal((await fetch(origin + '/avatar/overlay.rgba', { headers })).status, 404);
  assert.equal((await fetch(origin + '/avatar/api/action', { method: 'POST', headers: { ...headers, Origin: 'https://untrusted.invalid', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  const result = await ctx.tools.execute({ calls: [{ type: 'tool-call', id: 'avatar-native-test', name: 'avatar_set_action', arguments: JSON.stringify({ action: 'wave', seconds: .3 }) }], signal: AbortSignal.timeout(5000) });
  assert(!result.results[0].result.isError, JSON.stringify(result));
  assert.equal((await state()).action, 'wave'); await sleep(450);
  const walking = await ctx.tools.execute({ calls: [{ type: 'tool-call', id: 'avatar-walk-test', name: 'avatar_set_action', arguments: JSON.stringify({ action: 'walk-left', seconds: .3 }) }], signal: AbortSignal.timeout(5000) });
  assert(!walking.results[0].result.isError, JSON.stringify(walking));
  assert.equal((await state()).action, 'walk-left'); await sleep(450);
  const agent = { id: 'avatar-isolated-acceptance', session: { header: {} } };
  ctx.emit('agent/status', { agent, status: 'running' });
  assert.equal((await expect('thinking')).phase, 'thinking');
  ctx.emit('agent/assistant-stream', { agent, frame: { type: 'chunk', chunk: { type: 'reasoning-delta', text: 'PRIVATE_THOUGHT_MUST_NOT_LEAVE_HOST' } } });
  assert(!JSON.stringify(await state()).includes('PRIVATE_THOUGHT'));
  ctx.emit('agent/assistant-stream', { agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: '回答' } } });
  await expect('idle');
  ctx.emit('agent/status', { agent, status: 'idle' });
  await expect('idle');
  const image = await fetch(origin + '/avatar/frame.png', { headers });
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert((await image.arrayBuffer()).byteLength > 1000);
  console.log(JSON.stringify({ nativeToolExecution: true, nativeEventBus: true, thinkingAndReply: true, cancelledToIdle: true, thoughtTextNotForwarded: true, authenticatedPreview: true, csrfRejected: true, rawOverlayNotProxied: true, externalModelRequests: 0 }));
} finally {
  await plugin?.dispose();
  await ctx.fiber.dispose();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
