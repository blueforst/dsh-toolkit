import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../plugins/server-metrics/index.js';

function response() {
  return { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
}
test('Go 月额度共享一分钟缓存，合并并发请求并支持 HEAD', async () => {
  const original = { fetch: globalThis.fetch, now: Date.now, key: process.env.OPENCODE_GO_API_KEY, url: process.env.DSH_METRICS_URL };
  let now = 100000, calls = 0;
  const routes = new Map();
  process.env.OPENCODE_GO_API_KEY = 'test-credential';
  process.env.DSH_METRICS_URL = 'http://127.0.0.1:9191/metrics';
  Date.now = () => now;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://opencode.ai/inference/go/v1/usage');
    assert.equal(options.headers.Authorization, 'Bearer test-credential');
    await Promise.resolve();
    return { ok: true, json: async () => ({ usage: { monthly: { percent: 8, status: 'ok', resetsAt: '2026-12-01T00:00:00.000Z' } } }) };
  };
  try {
    apply({ effect: callback => callback(), connection: { requestRejection: request => request.rejection }, webServer: { register: route => routes.set(route.path, route) } });
    for (const route of routes.values()) {
      for (const rejection of [401, 403]) {
        const denied = response(); await route.handler({ method: 'GET', rejection }, denied);
        assert.equal(denied.status, rejection);
      }
    }
    assert.equal(calls, 0, '认证拒绝前不应调用官方接口');
    const get = async method => { const res = response(); await routes.get('/opencode-go-quota').handler({ method }, res); return res; };
    const [a, b] = await Promise.all([get('GET'), get('GET')]);
    assert.equal(calls, 1);
    assert.equal(a.body, b.body);
    assert.equal(JSON.parse(a.body).monthly.percent, 8);
    assert(!a.body.includes('test-credential'));
    now += 59000; await get('GET'); assert.equal(calls, 1);
    now += 1000; await get('GET'); assert.equal(calls, 2);
    const head = await get('HEAD'); assert.equal(head.status, 200); assert.equal(head.body, undefined);
    const invalid = await get('POST'); assert.equal(invalid.status, 405);
  } finally {
    globalThis.fetch = original.fetch; Date.now = original.now;
    for (const [name, value] of [['OPENCODE_GO_API_KEY', original.key], ['DSH_METRICS_URL', original.url]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
