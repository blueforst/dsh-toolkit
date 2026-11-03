import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
let checked = 0;
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist', '__pycache__'].includes(entry.name)) continue;
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) walk(path);
    else if (/\.([mc]?js)$/.test(path)) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
      checked++;
    } else if (path.endsWith('.json')) JSON.parse(readFileSync(path, 'utf8'));
    else if (path.endsWith('.sh')) {
      const result = spawnSync('bash', ['-n', path], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
    }
  }
}
walk(root);
console.log(`语法与 JSON 检查通过：${checked} 个 JavaScript 文件。`);
