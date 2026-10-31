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
  let quotaCache;
  let quotaPending;
  let nextQuotaAttempt = 0;
  async function readQuota() {
    if (quotaCache && Date.now() - quotaCache.timestamp < 60000) return quotaCache;
    if (quotaPending) return quotaPending;
    if (Date.now() < nextQuotaAttempt) throw new Error('额度暂不可用');
    quotaPending = (async () => {
      try {
        const key = process.env.OPENCODE_GO_API_KEY;
        if (!key) throw new Error('未配置额度凭据');
        const response = await fetch('https://opencode.ai/inference/go/v1/usage', {
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'User-Agent': 'opencode/2.1.2' },
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error('额度请求失败');
        const monthly = (await response.json()).usage?.monthly;
        if (!monthly || !Number.isFinite(monthly.percent) || monthly.percent < 0 || monthly.percent > 100 ||
          !['ok', 'rate-limited'].includes(monthly.status) || !Number.isFinite(Date.parse(monthly.resetsAt))) {
          throw new Error('额度数据格式无效');
        }
        quotaCache = {
          scope: 'opencode-go-monthly', timestamp: Date.now(),
          monthly: { percent: monthly.percent, status: monthly.status, resetsAt: monthly.resetsAt },
        };
        return quotaCache;
      } catch {
        nextQuotaAttempt = Date.now() + 10000;
        throw new Error('OpenCode Go 月额度暂不可用');
      }
    })().finally(() => { quotaPending = undefined; });
    return quotaPending;
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/opencode-go-quota',
    async handler(req, res) {
      if (!admitted(req, res)) return;
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end();
        return;
      }
      try {
        const body = JSON.stringify(await readQuota());
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ error: 'OpenCode Go 月额度暂不可用' }));
      }
    },
  }), 'server-metrics: OpenCode Go quota');
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
