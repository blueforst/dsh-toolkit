import { mountSessionMcp } from '@deepseek-ai/dsh-experimental-browser-use-runtime/mcp';

export const name = 'camoufox-browser-use';
export const inject = ['browserUse', 'agents', 'tools', 'systemPrompt', 'workingDirectory'];

export function apply(ctx) {
  // 沿用 DSH 的会话独占、工具归属和释放机制。
  mountSessionMcp(ctx, {
    name: 'camoufox',
    exclusive: true,
    command: process.execPath,
    args: ['/opt/dsh-camoufox/mcp-proxy.mjs'],
    toolCallTimeoutMs: 120000,
  });
}
