// 隔离集成测试的本地替身：只生成固定模型响应、资源和额度数据。
import http from 'node:http';
const host = process.env.FIXTURE_HOST || '127.0.0.1';
const port = Number(process.env.FIXTURE_PORT || 9199);
let completions = 0;
const server = http.createServer(async (req, res) => {
  if (req.url === '/metrics') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ scope: 'host', timestamp: Date.now(), cpu: { percent: 3.2, cores: 2 }, memory: { percent: 25, used: 2 ** 30, total: 4 * 2 ** 30 }, disk: { percent: 20, used: 10 * 2 ** 30, total: 50 * 2 ** 30 } }));
  }
  if (req.url === '/usage' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ usage: { monthly: { percent: 8, status: 'ok', resetsAt: '2026-12-01T00:00:00Z' } } }));
  }
  if (req.url === '/calls') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ completions })); }
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    for await (const _ of req) {};
    completions++;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const base = { id: 'toolkit-fixture', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'deepseek-v4.1-flash' };
    const send = chunk => res.write('data: ' + JSON.stringify({ ...base, ...chunk }) + '\n\n');
    send({ choices: [{ index: 0, delta: { role: 'assistant', content: '工具包隔离验收通过。' }, finish_reason: null }] });
    send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 11000, completion_tokens: 200, total_tokens: 11200, prompt_tokens_details: { cached_tokens: 10000 } } });
    return res.end('data: [DONE]\n\n');
  }
  res.writeHead(404); res.end();
});
server.listen(port, host, () => console.log('隔离测试替身服务已启动。'));
process.on('SIGTERM', () => server.close());
