import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const client = new Client({ name: 'dsh-camoufox-bridge', version: '1.1.0' });
const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:9222/mcp'));
await client.connect(transport);
const server = new Server({ name: 'camoufox-playwright', version: '1.1.0' }, { capabilities: { tools: {} },
  instructions: '完成整项浏览器任务后请调用 browser_close 释放浏览器。闲置自动回收后，后续工具调用会自动重启并保留登录数据。' });
server.setRequestHandler(ListToolsRequestSchema, () => client.listTools());
server.setRequestHandler(CallToolRequestSchema, request => client.callTool(request.params, undefined, { timeout: 120000 }));
await server.connect(new StdioServerTransport());
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  // close() 只关闭本地传输，不会通知 broker 删除远端会话。
  await transport.terminateSession().catch(() => {});
  await client.close().catch(() => {});
  await server.close().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.stdin.on('end', stop);
