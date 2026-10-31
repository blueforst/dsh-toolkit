import { readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const names = ['server-metrics', 'session-billing'];
const factories = names.map(name => {
  let captured;
  const source = readFileSync(new URL(`plugins/${name}/client.js`, root), 'utf8');
  runInNewContext(source, { window: { __ModuleLoader__: { load: value => { captured = value; } } } }, { timeout: 1000 });
  if (captured?.id !== `@forst/dsh-${name}` || typeof captured.factory !== 'function') throw new Error(`客户端模块格式不符：${name}`);
  return `(${captured.factory.toString()})(require)`;
});
const source = `// 由 scripts/build-client.mjs 生成；修改 plugins 下的源文件后重新构建。\nwindow.__ModuleLoader__.load({\n  id: '@forst/dsh-toolkit',\n  factory: require => {\n    const modules = [\n${factories.join(',\n')}\n    ];\n    return { inject: ['slots'], apply(ctx) { for (const module of modules) module.apply(ctx); } };\n  },\n});\n`;
writeFileSync(new URL('client.js', root), source);
console.log('已构建统一客户端模块。');
