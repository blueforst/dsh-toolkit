import test from 'node:test';
import assert from 'node:assert/strict';
import { AvatarEvents } from '../integrations/png-avatar/events.mjs';

test('真实流类型触发思考和回复，取消后回待机，且不转发模型文本', () => {
  const sent = [], state = new AvatarEvents(value => sent.push(value));
  const agent = { id: 'main', session: { header: {} } };
  state.status({ agent, status: 'running' });
  state.stream({ agent, frame: { type: 'chunk', chunk: { type: 'reasoning-delta', text: '禁止离开原主机的思考内容' } } });
  assert.equal(sent.at(-1).action, 'thinking');
  assert.equal(sent.length, 1, '逐 token 的相同状态不能逐次发网路请求');
  state.stream({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: '回复正文' } } });
  assert.equal(sent.at(-1).phase, 'replying');
  state.status({ agent, status: 'idle' });
  assert.equal(sent.at(-1).action, 'idle');
  assert.equal(sent.at(-1).sessionId, null);
  assert(!JSON.stringify(sent).includes('思考内容'));
  state.stream({ agent, frame: { type: 'chunk', chunk: { type: 'reasoning-delta', text: '取消后迟到的数据' } } });
  assert.equal(sent.at(-1).action, 'idle');
});

test('并发会话和子会话不能抢走正在直播的角色，心跳维持原状态', () => {
  const sent = [], state = new AvatarEvents(value => sent.push(value));
  const a = { id: 'a', session: { header: {} } }, b = { id: 'b', session: { header: {} } };
  state.status({ agent: a, status: 'running' });
  state.status({ agent: b, status: 'running' });
  state.status({ agent: b, status: 'idle' });
  state.heartbeat();
  assert.equal(sent.at(-1).sessionId, 'a');
  assert.equal(sent.at(-1).ttl, 35);
  state.status({ agent: a, status: 'idle' });
  state.status({ agent: { id: 'child', session: { header: { parentSession: 'a' } } }, status: 'running' });
  assert.equal(state.owner, null);
  state.status({ agent: b, status: 'running' });
  assert.equal(state.owner, 'b');
});
