import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Linux 采集器按自定义回环端口提供真实整机采样', { skip: process.platform !== 'linux' }, async () => {
  const seat = net.createServer();
  await new Promise(resolve => seat.listen(0, '127.0.0.1', resolve));
  const port = seat.address().port;
  await new Promise(resolve => seat.close(resolve));
  const child = spawn('python3', [fileURLToPath(new URL('../host/metrics.py', import.meta.url))], { env: { ...process.env, DSH_METRICS_BIND: '127.0.0.1', DSH_METRICS_PORT: String(port), DSH_METRICS_DISK: '/' }, stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    let sample;
    for (let attempt = 0; attempt < 25; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/metrics`);
        if (response.ok) { sample = await response.json(); break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(sample, '采集器没有生成样本');
    assert.equal(sample.scope, 'host');
    assert(sample.cpu.percent >= 0 && sample.cpu.percent <= 100 && sample.cpu.cores > 0);
    for (const kind of ['memory', 'disk']) assert(sample[kind].total > 0 && sample[kind].used >= 0 && sample[kind].used <= sample[kind].total);
    assert.equal((await fetch(`http://127.0.0.1:${port}/missing`)).status, 404);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
  }
});
