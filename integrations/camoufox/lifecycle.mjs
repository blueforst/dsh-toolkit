import { EventEmitter } from 'node:events';

// MCP 连接与浏览器进程分开存活，轮询不续期，正在执行的操作持有活动计数。
export class BrowserLifecycle extends EventEmitter {
  constructor({ launch, retire = async () => {}, readDesktopIdle, idleTimeoutMs = 1800000, now = Date.now }) {
    super();
    if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs < 1000) throw new Error('浏览器闲置时间必须至少为 1000 毫秒');
    Object.assign(this, { launch, retire, readDesktopIdle, idleTimeoutMs, now });
    this.context = null;
    this.starting = null;
    this.closing = null;
    this.active = 0;
    this.lastActivity = now();
    this.lastStopped = now();
    this.generation = 0;
    this.pendingClose = null;
    this.stopping = false;
  }

  status() {
    return { running: !!this.context, pages: this.context?.pages().length ?? 0, active: this.active,
      generation: this.generation, idleTimeoutMs: this.idleTimeoutMs,
      idleMs: this.context ? Math.max(0, this.now() - this.lastActivity) : 0 };
  }

  async ensure() {
    if (this.stopping) throw new Error('浏览器服务正在停止');
    if (this.closing) await this.closing;
    if (this.context) return this.context;
    if (!this.starting) {
      this.starting = (async () => {
        const context = await this.launch();
        this.context = context;
        this.generation++;
        this.lastActivity = this.now();
        context.on('close', () => {
          if (this.context !== context) return;
          this.context = null;
          this.lastStopped = this.now();
          this.closing = this.retire().finally(() => { this.closing = null; });
          this.closing.catch(error => this.emit('fault', error));
        });
        const track = page => page.on('download', download => {
          this.active++;
          download.path().catch(() => {}).finally(() => this.done()).catch(error => this.emit('fault', error));
        });
        for (const page of context.pages()) track(page);
        context.on('page', track);
        this.emit('started', this.generation);
        return context;
      })().finally(() => { this.starting = null; });
    }
    return this.starting;
  }

  async run(callback) {
    this.active++;
    this.lastActivity = this.now();
    try { return await callback(await this.ensure()); }
    finally { await this.done(); }
  }

  async done() {
    this.active--;
    this.lastActivity = this.now();
    if (!this.active && this.pendingClose) await this.close(this.pendingClose);
  }

  async close(reason = 'explicit') {
    if (this.active || this.starting) { this.pendingClose = reason; return false; }
    if (this.closing) { await this.closing; return true; }
    this.pendingClose = null;
    const context = this.context;
    this.context = null;
    this.lastStopped = this.now();
    this.closing = (async () => {
      await this.retire();
      if (context) {
        // 不把上一轮的标签页作为恢复会话带到下一轮；Cookie、配置目录和设备预设保留。
        await Promise.allSettled(context.pages().map(page => page.close()));
        await context.close();
        this.emit('released', reason);
      }
    })().finally(() => { this.closing = null; });
    await this.closing;
    return true;
  }

  async checkIdle() {
    if (this.checking || this.stopping || this.closing || this.starting) return;
    this.checking = true;
    try {
      const desktopIdle = await this.readDesktopIdle();
      if (!Number.isFinite(desktopIdle) || desktopIdle < 0) throw new Error('桌面闲置计数无效');
      const inputAt = this.now() - desktopIdle;
      if (!this.context) {
        if (inputAt > this.lastStopped + 50) await this.run(() => {});
        return;
      }
      this.lastActivity = Math.max(this.lastActivity, inputAt);
      if (!this.active && this.now() - this.lastActivity >= this.idleTimeoutMs) await this.close('idle');
    } finally { this.checking = false; }
  }

  async stop() {
    this.stopping = true;
    if (this.starting) await this.starting.catch(() => {});
    // 停机由容器统一结束工具；正常闲置回收从不强行清除活动计数。
    this.active = 0;
    await this.close('shutdown');
  }
}
