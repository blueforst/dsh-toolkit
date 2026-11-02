"""在服务器离线准备选定角色的小图；锁定来源，保留原作者许可。"""
import hashlib
import json
import os
from pathlib import Path
import urllib.request

from PIL import Image

root = Path(os.environ.get('AVATAR_DATA', '/data'))
lock = json.loads(Path(__file__).with_name('assets.json').read_text())
target = root / 'assets'
target.mkdir(parents=True, exist_ok=True)
base = f"https://raw.githubusercontent.com/{lock['repository']}/{lock['commit']}"


def download(path):
    request = urllib.request.Request(base + '/' + path, headers={'User-Agent': 'dsh-toolkit-avatar/0.1'})
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read()


manifest = {'name': '大肥鱼', 'author': lock['author'], 'repository': lock['repository'],
            'commit': lock['commit'], 'size': lock['size'], 'actions': {}}
for filename, spec in lock['sources'].items():
    raw = download('assets/whale/' + filename)
    digest = hashlib.sha1(f'blob {len(raw)}\0'.encode() + raw).hexdigest()
    if digest != spec['blob']:
        raise RuntimeError('上游素材校验失败：' + filename)
    import io
    image = Image.open(io.BytesIO(raw)).convert('RGBA')
    columns = spec['columns']
    assert image.width % columns == 0
    cell = image.width // columns
    assert image.height % cell == 0
    needed = sorted({frame for clip in lock['actions'].values() if clip['atlas'] == filename for frame in clip['frames']})
    for frame in needed:
        x, y = frame % columns * cell, frame // columns * cell
        assert y + cell <= image.height
        name = filename.removesuffix('.png') + '-' + str(frame) + '.png'
        tile = image.crop((x, y, x + cell, y + cell)).resize((lock['size'], lock['size']), Image.Resampling.LANCZOS)
        tile.save(target / name)
        if any(c['atlas'] == filename and c.get('flip') and frame in c['frames'] for c in lock['actions'].values()):
            tile.transpose(Image.Transpose.FLIP_LEFT_RIGHT).save(target / (filename.removesuffix('.png') + '-flip-' + str(frame) + '.png'))
    image.close()
for action, clip in lock['actions'].items():
    manifest['actions'][action] = {**clip, 'files': [clip['atlas'].removesuffix('.png') + ('-flip-' if clip.get('flip') else '-') + str(i) + '.png' for i in clip['frames']]}
for name in ['LICENSE', 'ASSET_LICENSE.md']:
    (target / name).write_bytes(download(name))
(target / 'ATTRIBUTION.txt').write_text(
    f"作者：{lock['author']}\n仓库：https://github.com/{lock['repository']}\n版本：{lock['commit']}\n"
    '修改：提取部分整身动画帧，统一缩小为 320 像素；思考动作使用托腮与歪头帧并保持；加入走路镜像差分。\n'
    '作者对其新增贡献授权；底层社区角色参考权利仍按原作者声明处理。\n')
(target / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print(json.dumps({'preparedFrames': len(list(target.glob('*.png'))), 'bytes': sum(p.stat().st_size for p in target.iterdir()),
                  'commit': lock['commit']}))
