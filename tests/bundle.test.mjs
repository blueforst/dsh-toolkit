import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('统一客户端只加载一个模块，注册两个侧栏区域和一个费用入口', () => {
  let definition;
  const styles = [], slots = [], cleanup = [];
  const sandbox = {
    window: { __ModuleLoader__: { load: value => { definition = value; } } },
    document: {
      createElement: () => ({ dataset: {}, remove() { this.removed = true; } }),
      head: { appendChild: element => styles.push(element) },
    },
  };
  runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), sandbox);
  assert.equal(definition.id, '@forst/dsh-toolkit');
  const plugin = definition.factory(name => {
    if (name === 'react') return { createElement: (...args) => args };
    if (name === 'react-dom') return { createPortal() {} };
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return {};
    throw new Error('非预期依赖：' + name);
  });
  plugin.apply({
    effect: callback => cleanup.push(callback()),
    slots: { inject: (_name, callback) => callback(), register: (spec, component) => { slots.push(spec); assert.equal(typeof component, 'function'); } },
  });
  assert.deepEqual(slots.map(slot => slot.id), ['server-metrics', 'opencode-go-quota', 'session-cost']);
  assert.equal(slots[2].order, -1);
  assert.equal(styles.length, 1);
  cleanup.forEach(dispose => dispose?.());
  assert(styles[0].removed);
});
