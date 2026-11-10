import test from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  rmSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, parse } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkSnapshot, repository, syncSnapshot } from '../scripts/sync-local.mjs';

const script = fileURLToPath(new URL('../scripts/sync-local.mjs', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}
function git(source, args) {
  return execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', source, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function commit(source, message = 'fixture source') {
  git(source, ['add', '.']);
  git(source, ['-c', 'user.name=Snapshot Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', message]);
  return git(source, ['rev-parse', 'HEAD']);
}
function fixture(t, { extra = false } = {}) {
  // The source is always a new fixture repository, never the developer's sibling
  // checkout. Cleanup is limited to the exact temporary directory created here.
  const temporary = mkdtempSync(join(realpathSync(tmpdir()), 'dsh-vendor-test-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const root = join(temporary, 'server-fixture');
  const source = join(temporary, 'local-fixture');
  mkdirSync(root); mkdirSync(source);
  const contents = {
    'index.js': "export const name = 'fixture-local';\n",
    'client.js': "window.__ModuleLoader__.load({ id: '@forst/dsh-toolkit-local', factory: () => ({}) });\n",
    'package.json': `${JSON.stringify({ name: '@forst/dsh-toolkit-local', version: '0.1.0', type: 'module' })}\n`,
    'cordis.patch.yml': '- insert: []\n',
    LICENSE: 'Fixture license only.\n',
    'NOTICE.md': 'Fixture attribution, not a published package.\n',
    'plugins/opencode-go-quota/index.js': 'export function apply() {}\n',
    'plugins/opencode-go-quota/client.js': 'export const fixture = true;\n',
    'plugins/opencode-go-quota/package.json': '{"private":true}\n',
    'plugins/session-billing/index.js': 'export function apply() {}\n',
    'plugins/session-billing/client.js': 'export const fixture = true;\n',
    'plugins/session-billing/package.json': '{"private":true}\n',
    'plugins/session-billing/projection.js': 'export const fixture = true;\n',
    'plugins/session-billing/runtime.js': 'export const fixture = true;\r\n',
    'README.md': 'This non-runtime file must not be copied.\n',
  };
  if (extra) contents['plugins/opencode-go-quota/old-helper.js'] = 'export const old = true;\n';
  for (const [path, bytes] of Object.entries(contents)) write(join(source, path), bytes);
  git(source, ['init', '-b', 'main']);
  git(source, ['config', 'core.autocrlf', 'false']);
  git(source, ['config', 'core.hooksPath', join(temporary, 'no-hooks')]);
  git(source, ['remote', 'add', 'origin', 'https://github.com/blueforst/dsh-toolkit-local.git']);
  const head = commit(source);
  const target = join(root, 'vendor/dsh-toolkit-local');
  const manifestPath = join(root, 'vendor/dsh-toolkit-local.source.json');
  const readManifest = () => JSON.parse(readFileSync(manifestPath, 'utf8'));
  const writeManifest = value => write(manifestPath, `${JSON.stringify(value, null, 2)}\n`);
  return { temporary, root, source, target, manifestPath, contents, head, readManifest, writeManifest };
}

test('固定 clean HEAD 生成白名单快照，逐字保留 blob，可离线及对源检查', t => {
  const f = fixture(t);
  const manifest = syncSnapshot({ root: f.root, source: f.source });
  assert.deepEqual(Object.keys(manifest), ['repository', 'commit', 'version', 'files']);
  assert.equal(manifest.repository, repository);
  assert.equal(manifest.commit, f.head);
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.files.length, 14);
  assert(!JSON.stringify(manifest).includes(f.temporary), 'provenance 不写入开发绝对路径');
  assert(!existsSync(join(f.target, 'README.md')));
  for (const entry of manifest.files) {
    const expected = Buffer.from(f.contents[entry.path]);
    assert(readFileSync(join(f.target, entry.path)).equals(expected));
    assert.equal(entry.sha256, digest(expected));
  }
  assert.deepEqual(checkSnapshot({ root: f.root }), manifest);
  assert.deepEqual(checkSnapshot({ root: f.root, source: f.source }), manifest);
  const headBefore = git(f.source, ['rev-parse', 'HEAD']);
  syncSnapshot({ root: f.root, source: f.source });
  assert.equal(git(f.source, ['rev-parse', 'HEAD']), headBefore);
  assert.equal(git(f.source, ['status', '--porcelain']), '');
});

test('快照 hash 被篡改时 check 和再次同步均拒绝覆盖', t => {
  const f = fixture(t);
  syncSnapshot({ root: f.root, source: f.source });
  const path = join(f.target, 'index.js');
  const changed = `${f.contents['index.js']}// manual edit\n`;
  write(path, changed);
  assert.throws(() => checkSnapshot({ root: f.root }), /SHA256 mismatch/);
  assert.throws(() => syncSnapshot({ root: f.root, source: f.source }), /SHA256 mismatch/);
  assert.equal(readFileSync(path, 'utf8'), changed);
});

test('快照缺失、多余文件和未知空目录都不能悄悄通过检查', t => {
  const f = fixture(t);
  syncSnapshot({ root: f.root, source: f.source });
  const extra = join(f.target, 'plugins/opencode-go-quota/extra.js');
  write(extra, 'export const unexpected = true;\n');
  assert.throws(() => checkSnapshot({ root: f.root }), /missing or extra/);
  assert.throws(() => syncSnapshot({ root: f.root, source: f.source }), /missing or extra/);
  assert(existsSync(extra));
  unlinkSync(extra);
  const unknown = join(f.target, 'untracked.txt');
  write(unknown, 'unrecorded');
  assert.throws(() => checkSnapshot({ root: f.root }), /outside snapshot runtime whitelist/);
  unlinkSync(unknown);
  const unknownDirectory = join(f.target, 'deployment');
  mkdirSync(unknownDirectory);
  assert.throws(() => checkSnapshot({ root: f.root }), /Unexpected directory/);
  rmdirSync(unknownDirectory);
  unlinkSync(join(f.target, 'client.js'));
  assert.throws(() => checkSnapshot({ root: f.root }), /missing or extra/);
});

test('脏源（已跟踪及未跟踪）在写入快照前就被拒绝', t => {
  const f = fixture(t);
  write(join(f.source, 'index.js'), `${f.contents['index.js']}// dirty\n`);
  assert.throws(() => syncSnapshot({ root: f.root, source: f.source }), /dirty/);
  assert(!existsSync(f.target));
  write(join(f.source, 'index.js'), f.contents['index.js']);
  write(join(f.source, 'untracked.txt'), 'dirty');
  assert.throws(() => syncSnapshot({ root: f.root, source: f.source }), /dirty/);
  assert(!existsSync(f.manifestPath));
});

test('源 revision 不匹配时对源校验失败，离线检查仍只验证原固定快照', t => {
  const f = fixture(t);
  syncSnapshot({ root: f.root, source: f.source });
  write(join(f.source, 'README.md'), 'A newer clean source revision.\n');
  const newer = commit(f.source, 'new revision');
  assert.notEqual(newer, f.head);
  assert.equal(checkSnapshot({ root: f.root }).commit, f.head);
  assert.throws(() => checkSnapshot({ root: f.root, source: f.source }), /revision does not match/);
  const next = syncSnapshot({ root: f.root, source: f.source });
  assert.equal(next.commit, newer);
  checkSnapshot({ root: f.root, source: f.source });
});

test('manifest 禁止路径穿越、重复条目、错误版本和非完整 SHA', t => {
  const f = fixture(t);
  const manifest = syncSnapshot({ root: f.root, source: f.source });
  for (const path of ['../../outside.js', '/index.js', 'plugins/opencode-go-quota/../../outside.js', 'plugins\\opencode-go-quota\\index.js']) {
    const bad = structuredClone(manifest);
    bad.files[0].path = path;
    f.writeManifest(bad);
    assert.throws(() => checkSnapshot({ root: f.root }), /whitelist/);
  }
  const duplicate = structuredClone(manifest);
  duplicate.files.push(duplicate.files[0]);
  f.writeManifest(duplicate);
  assert.throws(() => checkSnapshot({ root: f.root }), /Duplicate/);
  f.writeManifest({ ...manifest, commit: f.head.slice(0, 8) });
  assert.throws(() => checkSnapshot({ root: f.root }), /40-character/);
  f.writeManifest({ ...manifest, version: '0.2.0' });
  assert.throws(() => checkSnapshot({ root: f.root }), /version mismatch/);
  f.writeManifest({ ...manifest, repository: 'another/project' });
  assert.throws(() => checkSnapshot({ root: f.root }), /Unexpected source repository/);
  f.writeManifest(manifest);
  checkSnapshot({ root: f.root });
});

test('--init 仅接纳与源逐字匹配的未记录 preview，允许补齐缺失文件', t => {
  const f = fixture(t);
  write(join(f.target, 'index.js'), f.contents['index.js']);
  assert.throws(() => syncSnapshot({ root: f.root, source: f.source }), /Unrecorded snapshot/);
  syncSnapshot({ root: f.root, source: f.source, init: true });
  checkSnapshot({ root: f.root, source: f.source });
  assert.throws(() => syncSnapshot({ root: f.root, source: f.source, init: true }), /only for a snapshot without/);
});

test('--init 不覆盖不同 preview 或删除任何未知内容', t => {
  const f = fixture(t);
  const index = join(f.target, 'index.js');
  write(index, 'unrecorded local changes');
  assert.throws(() => syncSnapshot({ root: f.root, source: f.source, init: true }), /Refusing to overwrite/);
  assert.equal(readFileSync(index, 'utf8'), 'unrecorded local changes');
  assert(!existsSync(f.manifestPath));
  write(index, f.contents['index.js']);
  write(join(f.target, 'keep.txt'), 'do not remove');
  assert.throws(() => syncSnapshot({ root: f.root, source: f.source, init: true }), /whitelist/);
  assert.equal(readFileSync(join(f.target, 'keep.txt'), 'utf8'), 'do not remove');
});

test('更新只删除旧 manifest 已记录的过期白名单文件', t => {
  const f = fixture(t, { extra: true });
  syncSnapshot({ root: f.root, source: f.source });
  const unrelated = join(f.root, 'vendor/other-project.txt');
  write(unrelated, 'must remain');
  unlinkSync(join(f.source, 'plugins/opencode-go-quota/old-helper.js'));
  commit(f.source, 'remove obsolete helper');
  syncSnapshot({ root: f.root, source: f.source });
  assert(!existsSync(join(f.target, 'plugins/opencode-go-quota/old-helper.js')));
  assert.equal(readFileSync(unrelated, 'utf8'), 'must remain');
  checkSnapshot({ root: f.root, source: f.source });
});

test('拒绝错误来源、checkout 子目录和危险的根目录 source', t => {
  const f = fixture(t);
  assert.throws(() => syncSnapshot({ root: f.root, source: join(f.source, 'plugins') }), /checkout root/);
  assert.throws(() => syncSnapshot({ root: f.root, source: parse(f.source).root }), /Invalid source/);
  git(f.source, ['remote', 'set-url', 'origin', 'https://github.com/another/project.git']);
  assert.throws(() => syncSnapshot({ root: f.root, source: f.source }), /Source origin/);
  assert(!existsSync(f.target));
});

test('拒绝源目录和快照父目录的符号链接', t => {
  const f = fixture(t);
  const alias = join(f.temporary, 'source-alias');
  symlinkSync(f.source, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => syncSnapshot({ root: f.root, source: alias }), /symlink/);
  const external = join(f.temporary, 'outside');
  mkdirSync(external);
  write(join(external, 'sentinel.txt'), 'untouched');
  symlinkSync(external, join(f.root, 'vendor'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => syncSnapshot({ root: f.root, source: f.source }), /symlink/);
  assert.equal(readFileSync(join(external, 'sentinel.txt'), 'utf8'), 'untouched');
  assert(!existsSync(join(external, 'dsh-toolkit-local')));
});

test('拒绝快照内文件符号链接与 Git 源 blob 符号链接', { skip: process.platform === 'win32' && '文件符号链接需要 Windows 额外权限；服务器验证基线为 Linux' }, t => {
  const f = fixture(t);
  syncSnapshot({ root: f.root, source: f.source });
  const external = join(f.temporary, 'outside.txt');
  write(external, 'untouched');
  unlinkSync(join(f.target, 'LICENSE'));
  symlinkSync(external, join(f.target, 'LICENSE'));
  assert.throws(() => checkSnapshot({ root: f.root }), /symlink/);
  assert.throws(() => syncSnapshot({ root: f.root, source: f.source }), /symlink/);
  assert.equal(readFileSync(external, 'utf8'), 'untouched');
  unlinkSync(join(f.source, 'LICENSE'));
  symlinkSync('NOTICE.md', join(f.source, 'LICENSE'));
  commit(f.source, 'symlink fixture');
  assert.throws(() => syncSnapshot({ root: f.root, source: f.source }), /regular Git blobs/);
});

test('对源检查发现快照与 manifest 一起被改写的内容', t => {
  const f = fixture(t);
  const manifest = syncSnapshot({ root: f.root, source: f.source });
  const changed = Buffer.from('export const changed = true;\n');
  write(join(f.target, 'index.js'), changed);
  manifest.files.find(entry => entry.path === 'index.js').sha256 = digest(changed);
  f.writeManifest(manifest);
  checkSnapshot({ root: f.root });
  assert.throws(() => checkSnapshot({ root: f.root, source: f.source }), /Source blob differs/);
});

test('CLI check 为只读；参数错误不会初始化快照', t => {
  const f = fixture(t);
  const fixtureScript = join(f.root, 'scripts/sync-local.mjs');
  mkdirSync(dirname(fixtureScript), { recursive: true });
  copyFileSync(script, fixtureScript);
  const run = args => spawnSync(process.execPath, [fixtureScript, ...args], { encoding: 'utf8', cwd: f.root });
  assert.notEqual(run(['--source']).status, 0);
  assert.notEqual(run(['--check', '--init']).status, 0);
  assert(!existsSync(f.target));
  const synced = run(['--source', f.source]);
  assert.equal(synced.status, 0, synced.stderr);
  const before = readFileSync(f.manifestPath);
  const checked = run(['--check', '--source', f.source]);
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /Verified/);
  assert(readFileSync(f.manifestPath).equals(before));
});
