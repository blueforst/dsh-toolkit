import { existsSync, readFileSync } from 'node:fs';

export const name = 'server-metrics';
export const inject = ['webServer', 'connection'];

function gateway() {
  const rows = readFileSync('/proc/net/route', 'utf8').trim().split('\n').slice(1);
  for (const row of rows) {
    const parts = row.trim().split(/\s+/);
    if (parts[1] !== '00000000' || parts[2] === '00000000') continue;
    return parts[2].match(/../g).reverse().map(byte => parseInt(byte, 16)).join('.');
  }
  throw new Error('没有找到容器默认网关');
}

export function apply(ctx) {
  const endpoint = process.env.DSH_METRICS_URL || (existsSync('/.dockerenv') ? `http://${gateway()}:9191/metrics` : 'http://127.0.0.1:9191/metrics');
  function admitted(req, res) {
    const rejection = ctx.connection.requestRejection(req);
    if (rejection === undefined) return true;
    res.writeHead(rejection, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ error: '需要通过 DSH 登录访问' }));
    return false;
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/server-metrics',
    async handler(req, res) {
      if (!admitted(req, res)) return;
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end();
        return;
      }
      try {
        const response = await fetch(endpoint, { signal: AbortSignal.timeout(1500) });
        if (!response.ok) throw new Error('服务器采样暂不可用');
        const data = await response.json();
        if (data.scope !== 'host' || !Number.isFinite(data.timestamp)) throw new Error('采样格式无效');
        const body = JSON.stringify(data);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ error: '服务器资源采样暂不可用' }));
      }
    },
  }), 'server-metrics: HTTP');
}
