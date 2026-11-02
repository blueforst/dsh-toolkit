import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BrowserLifecycle } from '../integrations/camoufox/lifecycle.mjs';

function fixture(options = {}) {
  let time = 0, inputAt = 0, launches = 0, retired = 0;
  const contexts = [];
  const manager = new BrowserLifecycle({
    now: () => time, idleTimeoutMs: 5000, readDesktopIdle: async () => time - inputAt,
    launch: async () => {
      launches++;
      const page = new EventEmitter();
      page.close = async () => { page.closed = true; };
      const context = new EventEmitter();
      context.pages = () => [page];
      context.close = async () => { context.closed = true; context.emit('close'); };
      contexts.push(context);
      return context;
    },
    retire: async () => { retired++; }, ...options,
  });
  return { manager, contexts, advance: ms => { time += ms; }, input: () => { inputAt = time; },
    launches: () => launches, retired: () => retired };
}

test('默认闲置回收时间为三十分钟', () => {
  const manager = new BrowserLifecycle({ launch: async () => {}, readDesktopIdle: async () => 0 });
  assert.equal(manager.status().idleTimeoutMs, 30 * 60 * 1000);
});

test('启动与状态轮询不创建浏览器；并发首次调用仅启动一个实例；闲置关闭全部标签', async () => {
  const f = fixture();
  f.advance(10000);
  for (let i = 0; i < 4; i++) { f.manager.status(); await f.manager.checkIdle(); }
  assert.equal(f.launches(), 0);
  await Promise.all([f.manager.run(() => {}), f.manager.run(() => {})]);
  assert.equal(f.launches(), 1);
  f.advance(4999); await f.manager.checkIdle();
  assert.equal(f.manager.status().running, true);
  f.advance(1); await f.manager.checkIdle();
  assert.equal(f.contexts[0].closed, true);
  assert.equal(f.contexts[0].pages()[0].closed, true);
  await f.manager.run(() => {});
  assert.equal(f.launches(), 2);
});

test('长工具执行期间不回收；从操作结束重新计时', async () => {
  const f = fixture();
  let finish;
  const operation = f.manager.run(() => new Promise(resolve => { finish = resolve; }));
  await new Promise(setImmediate);
  f.advance(20000); await f.manager.checkIdle();
  assert.equal(f.manager.status().running, true);
  finish(); await operation;
  f.advance(4999); await f.manager.checkIdle();
  assert.equal(f.manager.status().running, true);
  f.advance(1); await f.manager.checkIdle();
  assert.equal(f.manager.status().running, false);
});

test('桌面键鼠续期，释放后新的键鼠操作能唤醒浏览器', async () => {
  const f = fixture();
  await f.manager.run(() => {});
  f.advance(4000); f.input();
  f.advance(2000); await f.manager.checkIdle();
  assert.equal(f.manager.status().running, true);
  f.advance(3000); await f.manager.checkIdle();
  assert.equal(f.manager.status().running, false);
  f.advance(1000); await f.manager.checkIdle();
  assert.equal(f.launches(), 1);
  f.input(); await f.manager.checkIdle();
  assert.equal(f.launches(), 2);
});

test('下载保护与显式关闭请求：下载完成才释放', async () => {
  const f = fixture();
  await f.manager.run(() => {});
  let finish;
  f.contexts[0].pages()[0].emit('download', { path: () => new Promise(resolve => { finish = resolve; }) });
  f.advance(10000); await f.manager.checkIdle();
  assert.equal(f.manager.status().running, true);
  assert.equal(await f.manager.close('tool'), false);
  finish(); await new Promise(setImmediate);
  assert.equal(f.manager.status().running, false);
  assert.equal(f.retired(), 1);
});

test('完整桌面不因其他应用的键鼠唤醒浏览器；已有浏览器仍续期和回收', async () => {
  const f = fixture({ desktopWakeEnabled: false });
  f.advance(1000); f.input(); await f.manager.checkIdle();
  assert.equal(f.launches(), 0);
  await f.manager.run(() => {});
  f.advance(4000); f.input();
  f.advance(2000); await f.manager.checkIdle();
  assert.equal(f.manager.status().running, true);
  f.advance(3000); await f.manager.checkIdle();
  assert.equal(f.manager.status().running, false);
  f.advance(1000); f.input(); await f.manager.checkIdle();
  assert.equal(f.launches(), 1);
  await f.manager.run(() => {});
  assert.equal(f.launches(), 2);
});

test('桌面探测失败不误关；浏览器被手动关闭后不退出服务且能够重启', async () => {
  const f = fixture({ readDesktopIdle: async () => { throw new Error('X11 故障'); } });
  await f.manager.run(() => {});
  f.advance(20000);
  await assert.rejects(f.manager.checkIdle(), /X11/);
  assert.equal(f.manager.status().running, true);
  await f.contexts[0].close();
  await f.manager.run(() => {});
  assert.equal(f.launches(), 2);
  assert.equal(f.retired(), 1);
});

test('启动失败可重试，回收与新启动互斥', async () => {
  let attempt = 0, release;
  const f = fixture({ retire: () => new Promise(resolve => { release = resolve; }) });
  const original = f.manager.launch;
  f.manager.launch = () => ++attempt === 1 ? Promise.reject(new Error('启动失败')) : original();
  await assert.rejects(f.manager.run(() => {}), /启动失败/);
  await f.manager.run(() => {});
  const closing = f.manager.close();
  const reopening = f.manager.run(() => {});
  await new Promise(setImmediate);
  assert.equal(f.launches(), 1);
  release(); await closing; await reopening;
  assert.equal(f.launches(), 2);
  assert.equal(f.contexts[0].closed, true);
});
