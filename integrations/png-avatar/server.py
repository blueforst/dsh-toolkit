"""私网角色服务：播放预制小图片，不运行图像模型或骨骼引擎。"""
import hmac
import json
import math
import os
from pathlib import Path
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from PIL import Image

DATA = Path(os.environ.get('AVATAR_DATA', '/data'))
ASSETS = DATA / 'assets'
MANIFEST = json.loads((ASSETS / 'manifest.json').read_text())
TOKEN = Path(os.environ.get('AVATAR_TOKEN_FILE', '/run/secrets/avatar_token')).read_text().strip()
if len(TOKEN) < 32:
    raise RuntimeError('角色服务需要至少 32 字符的独立控制凭据')
PNG = {name: (ASSETS / name).read_bytes() for clip in MANIFEST['actions'].values() for name in clip['files']}
RGBA = {}
for name in PNG:
    with Image.open(ASSETS / name) as image:
        RGBA[name] = image.convert('RGBA').tobytes()
LOCK = threading.Lock()
AUTO = {'action': 'idle', 'phase': 'idle', 'source': 'auto', 'sessionId': None, 'expires': 0, 'startedAt': time.time() * 1000}
MANUAL = None


def current():
    global MANUAL
    with LOCK:
        now = time.monotonic()
        if MANUAL and MANUAL['expires'] <= now:
            MANUAL = None
        item = MANUAL or AUTO
        if item['expires'] <= now:
            return {'action': 'idle', 'phase': 'idle', 'source': 'default', 'sessionId': None, 'startedAt': 0}
        return {k: v for k, v in item.items() if k != 'expires'}


def set_action(body):
    global MANUAL
    action, source = body.get('action'), body.get('source', 'manual')
    ttl = body.get('ttl', 5)
    if action not in MANIFEST['actions'] or source not in ['manual', 'auto']:
        raise ValueError('未知角色动作或来源')
    if isinstance(ttl, bool) or not isinstance(ttl, (int, float)) or not math.isfinite(ttl) or not .25 <= ttl <= 60:
        raise ValueError('动作持续时间应在 0.25–60 秒之间')
    session = body.get('sessionId')
    if session is not None and (not isinstance(session, str) or len(session) > 256):
        raise ValueError('会话标识无效')
    phase = body.get('phase', action)
    if phase not in ['idle', 'thinking', 'replying', 'working', 'error', 'manual', *MANIFEST['actions']]:
        raise ValueError('未知会话状态')
    with LOCK:
        before = AUTO if source == 'auto' else MANUAL
        same = before and before['action'] == action and before['sessionId'] == session and before['expires'] > time.monotonic()
        value = {'action': action, 'phase': phase, 'source': source, 'sessionId': session,
                 'startedAt': before['startedAt'] if same else time.time() * 1000, 'expires': time.monotonic() + ttl}
        if source == 'auto':
            AUTO.update(value)
        else:
            MANUAL = value
    return current()


def frame_name(state=None):
    state = state or current()
    clip = MANIFEST['actions'][state['action']]
    elapsed = max(0, time.time() * 1000 - state['startedAt'])
    duration = sum(clip['times'])
    if clip['loop']:
        elapsed %= duration
    elif elapsed >= duration:
        return MANIFEST['actions']['idle']['files'][0]
    for name, ms in zip(clip['files'], clip['times']):
        if elapsed < ms:
            return name
        elapsed -= ms
    return clip['files'][-1]


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *_):
        pass

    def send(self, status, body=b'', content_type='application/json; charset=utf-8', **headers):
        if isinstance(body, dict):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        headers = {k.replace('_', '-'): v for k, v in headers.items()}
        for k, v in {'Content-Type': content_type, 'Content-Length': str(len(body)), 'Cache-Control': 'no-store',
                     'X-Content-Type-Options': 'nosniff', **headers}.items():
            self.send_header(k.replace('_', '-'), v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def admitted(self):
        return hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + TOKEN)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/health':
            return self.send(200, {'ready': True, 'frames': len(PNG), 'size': MANIFEST['size']})
        # 原始透明帧仅供同容器的 FFmpeg 使用；不通过 DSH 预览代理暴露。
        if path == '/overlay.rgba' and self.client_address[0] == '127.0.0.1':
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Connection', 'close')
            self.end_headers()
            self.close_connection = True
            deadline = time.monotonic()
            try:
                while True:
                    self.wfile.write(RGBA[frame_name()])
                    self.wfile.flush()
                    deadline += 1 / 12
                    time.sleep(max(0, deadline - time.monotonic()))
            except (BrokenPipeError, ConnectionResetError):
                return
        if not self.admitted():
            return self.send(401, {'error': '需要角色服务凭据'})
        if path == '/':
            return self.send(200, Path(__file__).with_name('stage.html').read_bytes(), 'text/html; charset=utf-8')
        if path == '/manifest.json':
            return self.send(200, MANIFEST)
        if path == '/api/state':
            return self.send(200, current())
        if path == '/frame.png':
            return self.send(200, PNG[frame_name()], 'image/png')
        if path.startswith('/assets/') and path.removeprefix('/assets/') in PNG:
            return self.send(200, PNG[path.removeprefix('/assets/')], 'image/png', Cache_Control='private, max-age=86400')
        if path == '/preview.mp4' and (DATA / 'preview.mp4').exists():
            file = DATA / 'preview.mp4'
            size = file.stat().st_size
            start, end, status = 0, size - 1, 200
            value = self.headers.get('Range')
            if value:
                m = re.fullmatch(r'bytes=(\d+)-(\d*)', value)
                if not m:
                    return self.send(416, {'error': '无效视频范围'}, Content_Range=f'bytes */{size}')
                start, end = int(m[1]), min(int(m[2]) if m[2] else size - 1, size - 1)
                if start > end:
                    return self.send(416, {'error': '无效视频范围'}, Content_Range=f'bytes */{size}')
                status = 206
            self.send_response(status)
            self.send_header('Content-Type', 'video/mp4')
            self.send_header('Content-Length', str(end - start + 1))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Cache-Control', 'no-store')
            if status == 206:
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.end_headers()
            if self.command != 'HEAD':
                with file.open('rb') as stream:
                    stream.seek(start)
                    remaining = end - start + 1
                    while remaining:
                        chunk = stream.read(min(65536, remaining))
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
            return
        return self.send(404, {'error': '没有此资源'})

    def do_POST(self):
        if not self.admitted():
            return self.send(401, {'error': '需要角色服务凭据'})
        if urlsplit(self.path).path != '/api/action':
            return self.send(404, {'error': '没有此接口'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 8192:
                raise ValueError('请求体大小无效')
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError('请求应为对象')
            return self.send(200, set_action(body))
        except (ValueError, TypeError, KeyError):
            return self.send(400, {'error': '无效角色指令'})


if __name__ == '__main__':
    server = ThreadingHTTPServer((os.environ.get('AVATAR_HOST', '0.0.0.0'), int(os.environ.get('AVATAR_PORT', '19380'))), Handler)
    server.daemon_threads = True
    print(json.dumps({'ready': True, 'frames': len(PNG), 'commit': MANIFEST['commit']}), flush=True)
    server.serve_forever()
