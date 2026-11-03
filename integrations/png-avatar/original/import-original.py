"""下载并校验完整原版运行文件，不缩图、不抽帧、不重写动画模块。"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.request
from urllib.parse import quote

lock = json.loads(Path(__file__).with_name('original-lock.json').read_text())
target = Path(os.environ.get('AVATAR_ORIGINAL_DIR', '/data/original'))
target.mkdir(parents=True, exist_ok=True)
base = f"https://raw.githubusercontent.com/{lock['repository']}/{lock['commit']}/"


def fetch(item):
    path = target / item['path']
    def valid(raw):
        return hashlib.sha1(f'blob {len(raw)}\0'.encode() + raw).hexdigest() == item['blob']
    if path.exists() and valid(path.read_bytes()):
        return
    for attempt in range(3):
        try:
            request = urllib.request.Request(base + quote(item['path']), headers={'User-Agent': 'dsh-original-avatar'})
            with urllib.request.urlopen(request, timeout=60) as response:
                raw = response.read()
            if not valid(raw):
                raise ValueError('上游文件摘要不一致：' + item['path'])
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_name(path.name + '.download')
            temporary.write_bytes(raw)
            temporary.replace(path)
            return
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


with ThreadPoolExecutor(max_workers=4) as pool:
    list(pool.map(fetch, lock['files']))
(target / 'DSH-PROVENANCE.json').write_text(json.dumps(lock, ensure_ascii=False, indent=2))
script = "const r=process.argv[1],m=require(r+'/src/renderer/motion.js'),b=require(r+'/src/main/behavior.cjs');console.log(JSON.stringify({clips:m.clips,actions:Object.keys(b.ACTIONS)}))"
meta = json.loads(subprocess.check_output(['node', '-e', script, str(target.resolve())]))
meta.update({'commit': lock['commit'], 'repository': lock['repository'], 'renderer': 'original', 'fps': 60})
(target / 'DSH-CLIPS.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2))
renderer = target / 'src/renderer'
compat = Path(os.environ.get('AVATAR_WEBGL_COMPAT', str(Path(__file__).with_name('webgl-compat.js'))))
shutil.copyfile(compat, renderer / 'dsh-webgl.js')
html = (renderer / 'index.html').read_text()
assert '<script src="motion.js">' in html
desktop = html.replace('<script src="motion.js">', '<script src="dsh-webgl.js"></script><script src="motion.js">')
(renderer / 'dsh-index.html').write_text(desktop)
preview = desktop.replace("connect-src 'none'", "connect-src 'self'")
preview = preview.replace('<script src="app.js">', '<script src="../../../preview-bridge.js"></script><script src="app.js">')
(renderer / 'dsh-player.html').write_text(preview)
print(json.dumps({'verifiedFiles': len(lock['files']), 'commit': lock['commit'],
                  'bytes': sum((target / item['path']).stat().st_size for item in lock['files'])}))
