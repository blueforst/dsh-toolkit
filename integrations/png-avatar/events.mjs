// 只消费事件类型，不读取或转发模型文本。一个角色由一个活跃根会话占用。
export class AvatarEvents {
  constructor(publish, sessionId) {
    this.publish = publish;
    this.watched = sessionId;
    this.owner = null;
    this.phase = 'idle';
  }
  claim(agent) {
    const id = String(agent.id), header = agent.session?.header;
    if (header?.origin === 'subagent' || header?.parentSession || header?.meta?.origin === 'subagent') return false;
    if (this.watched && this.watched !== id) return false;
    if (this.owner && this.owner !== id) return false;
    this.owner = id;
    return true;
  }
  value() {
    return { source: 'auto', action: ['thinking', 'working'].includes(this.phase) ? 'thinking' : this.phase === 'error' ? 'sad' : 'idle',
      phase: this.phase, sessionId: this.owner, ttl: 35 };
  }
  set(phase, force = false) {
    if (this.phase === phase && !force) return;
    this.phase = phase;
    this.publish(this.value());
  }
  status({ agent, status }) {
    if (status === 'running' && this.claim(agent)) this.set('thinking', true);
    if (status === 'idle' && this.owner === String(agent.id)) this.release();
  }
  stream({ agent, frame }) {
    if (frame.type === 'start' && this.claim(agent)) this.set('thinking', true);
    if (this.owner !== String(agent.id) || frame.type !== 'chunk') return;
    if (frame.chunk.type === 'reasoning-delta') this.set('thinking');
    if (frame.chunk.type === 'text-delta') this.set('replying');
  }
  session(session, event) {
    if (this.owner !== String(session.id)) return;
    if (event.type === 'step/start') this.set('thinking');
    if (event.type === 'tool/call') this.set('working');
    if (event.type === 'turn/end') this.release();
  }
  release() {
    this.owner = null;
    this.set('idle', true);
  }
  heartbeat() {
    if (this.owner) this.publish(this.value());
  }
}
