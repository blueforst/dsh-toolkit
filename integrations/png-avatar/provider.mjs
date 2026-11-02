import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { AvatarEvents } from './events.mjs';

export const name = 'png-avatar';
export const inject = ['agents', 'sessions', 'tools', 'webServer', 'connection'];
const actions = ['idle', 'thinking', 'wave', 'happy', 'sad', 'surprised', 'walk-left', 'walk-right'];

export function apply(ctx, config = {}) {
  const file = config.configFile || process.env.DSH_AVATAR_CONFIG || `${process.env.DSH_HOME || `${homedir()}/.dsh`}/avatar/config.json`;
  const settings = JSON.parse(readFileSync(file, 'utf8'));
  const url = new URL(settings.url);
  if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/') throw new Error('角色地址必须是私网 HTTP 根地址');
  const host = url.hostname;
  if (isIP(host) !== 4 || !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) throw new Error('角色地址只允许私网或回环 IPv4');
  const token = readFileSync(settings.tokenFile, 'utf8').trim();
  if (token.length < 32) throw new Error('角色控制凭据无效');
  let pending, sending = false, disposed = false, lastFailure = 0;
  const request = async (path, body, signal = AbortSignal.timeout(2000)) => {
    const response = await fetch(new URL(path, url), { method: body ? 'POST' : 'GET', headers: {
      Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}),
    }, body: body ? JSON.stringify(body) : undefined, signal, redirect: 'error' });
    if (!response.ok) throw new Error(`角色服务返回 ${response.status}`);
    return response.json();
  };
  async function flush() {
    if (sending || disposed) return;
    sending = true;
    try {
      while (pending && !disposed) {
        const body = pending; pending = undefined;
        try { await request('/api/action', body); }
        catch {
          if (Date.now() - lastFailure > 30000) { lastFailure = Date.now(); console.warn('[png-avatar] 角色服务暂不可用；agent 继续运行。'); }
        }
      }
    } finally { sending = false; }
  }
  const state = new AvatarEvents(body => { pending = body; void flush(); }, settings.sessionId);
  const disposers = [
    ctx.on('agent/status', event => state.status(event)),
    ctx.on('agent/assistant-stream', event => state.stream(event)),
    ctx.on('session/event', (session, event) => state.session(session, event)),
    ctx.on('agent/error', ({ agent }) => { if (state.owner === String(agent.id)) state.set('error'); }),
    ctx.on('agent/disposed', ({ agent }) => { if (state.owner === String(agent.id)) state.release(); }),
  ];
  const heartbeat = setInterval(() => state.heartbeat(), 15000);
  heartbeat.unref?.();
  state.release();

  ctx.tools.register(defineTool({
    name: 'avatar_set_action',
    description: '切换直播角色的表情或动作。DSH 思考状态自动联动，无需用工具模拟思考。手动动作持续数秒后恢复自动状态。',
    parameters: {
      action: { type: 'string', required: true, enum: actions, description: 'idle 待机；thinking 思考；wave 挥手；happy 开心；sad 难过；surprised 惊讶；walk-left 向左走；walk-right 向右走。' },
      seconds: { type: 'number', description: '持续秒数，0.25–30，默认 3。' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const seconds = args.seconds ?? 3;
      if (!Number.isFinite(seconds) || seconds < .25 || seconds > 30) throw new Error('动作持续时间应在 0.25–30 秒之间');
      return request('/api/action', { action: args.action, source: 'manual', phase: 'manual', sessionId: exec.agent?.id ? String(exec.agent.id) : null, ttl: seconds }, exec.signal);
    },
  }));
  ctx.tools.register(defineTool({
    name: 'avatar_get_state', description: '读取直播角色当前动作和状态来源；预览地址为当前 DSH 网站的 /avatar/。', parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (_args, exec) => request('/api/state', undefined, exec.signal),
    isConcurrencySafe: () => true,
  }));

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/avatar',
    async handler(req, res) {
      const rejection = ctx.connection.requestRejection(req);
      if (rejection !== undefined) { res.writeHead(rejection); return res.end(); }
      const incoming = new URL(req.url, 'http://localhost');
      if (incoming.pathname === '/avatar') { res.writeHead(302, { Location: '/avatar/' }); return res.end(); }
      const path = incoming.pathname.slice('/avatar'.length);
      const allowed = ['/', '/manifest.json', '/api/state', '/api/action', '/frame.png', '/preview.mp4'].includes(path) || /^\/assets\/[a-z0-9-]+\.png$/.test(path);
      if (!allowed || !['GET', 'HEAD', 'POST'].includes(req.method) || (req.method === 'POST' && path !== '/api/action')) { res.writeHead(404); return res.end(); }
      if (req.method === 'POST' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) { res.writeHead(403); return res.end(); }
      try {
        let body;
        if (req.method === 'POST') {
          const chunks = []; let size = 0;
          for await (const chunk of req) { size += chunk.length; if (size > 8192) { res.writeHead(413); return res.end(); } chunks.push(chunk); }
          body = Buffer.concat(chunks);
        }
        const abort = new AbortController();
        res.on('close', () => abort.abort());
        const response = await fetch(new URL(path + incoming.search, url), { method: req.method, headers: {
          Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(req.headers.range ? { Range: req.headers.range } : {}),
        }, body, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]), redirect: 'error' });
        const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
        for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (response.headers.has(key)) headers[key] = response.headers.get(key);
        res.writeHead(response.status, headers);
        if (!response.body || req.method === 'HEAD') return res.end();
        const stream = Readable.fromWeb(response.body);
        stream.on('error', () => res.destroy());
        stream.pipe(res);
      } catch { if (!res.headersSent) res.writeHead(503); res.end(); }
    },
  }), 'png-avatar: authenticated preview');
  ctx.effect(() => () => {
    clearInterval(heartbeat); for (const dispose of disposers) dispose();
    disposed = true; pending = undefined;
    void request('/api/action', { source: 'auto', action: 'idle', phase: 'idle', sessionId: null, ttl: 1 }).catch(() => {});
  });
}
