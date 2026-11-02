"""轻量 X11 桌宠：预制图片、透明轮廓、鼠标穿透；不依赖 Electron 或 GPU。"""
import ctypes as C
from ctypes.util import find_library
import io
import json
import os
from pathlib import Path
import random
import signal
import threading
import time
import urllib.request

from PIL import Image

config = json.loads(Path(os.environ.get('AVATAR_DESKTOP_CONFIG', '/data/config.json')).read_text())
token = Path(config['tokenFile']).read_text().strip()
size = max(128, min(384, int(config.get('size', 240))))


def get(path, limit=524288):
    request = urllib.request.Request(config['url'].rstrip('/') + path, headers={'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(request, timeout=4) as response:
        raw = response.read(limit + 1)
    if len(raw) > limit:
        raise RuntimeError('角色响应超过大小限制')
    return raw


manifest = json.loads(get('/manifest.json', 65536))
files = sorted({name for clip in manifest['actions'].values() for name in clip['files']})
if len(files) > 96:
    raise RuntimeError('角色帧数超过本播放器限制')
png = {name: get('/assets/' + name) for name in files}
latest = {'action': 'idle', 'phase': 'idle', 'startedAt': 0}
lock = threading.Lock()
stop = threading.Event()


def poll():
    global latest
    last_ok = time.monotonic()
    while not stop.is_set():
        try:
            value = json.loads(get('/api/state', 8192))
            if value.get('action') in manifest['actions']:
                with lock:
                    latest = value
                last_ok = time.monotonic()
        except Exception:
            if time.monotonic() - last_ok > 5:
                with lock:
                    latest = {'action': 'idle', 'phase': 'idle', 'startedAt': 0}
        stop.wait(.35)


X = C.CDLL(find_library('X11'))
S = C.CDLL(find_library('Xext'))
libc = C.CDLL(None)
D, W = C.c_void_p, C.c_ulong


def bind(lib, name, restype, *args):
    fn = getattr(lib, name)
    fn.restype, fn.argtypes = restype, list(args)
    return fn


class Attributes(C.Structure):
    _fields_ = [('background_pixmap', W), ('background_pixel', W), ('border_pixmap', W), ('border_pixel', W),
                ('bit_gravity', C.c_int), ('win_gravity', C.c_int), ('backing_store', C.c_int),
                ('backing_planes', W), ('backing_pixel', W), ('save_under', C.c_int),
                ('event_mask', C.c_long), ('do_not_propagate_mask', C.c_long), ('override_redirect', C.c_int),
                ('colormap', W), ('cursor', W)]


class Rect(C.Structure):
    _fields_ = [('x', C.c_short), ('y', C.c_short), ('width', C.c_ushort), ('height', C.c_ushort)]


class Event(C.Union):
    _fields_ = [('type', C.c_int), ('padding', C.c_long * 24)]


bind(X, 'XOpenDisplay', D, C.c_char_p)
bind(X, 'XDefaultScreen', C.c_int, D)
bind(X, 'XDefaultVisual', D, D, C.c_int)
bind(X, 'XDefaultDepth', C.c_int, D, C.c_int)
bind(X, 'XDefaultRootWindow', W, D)
bind(X, 'XDisplayWidth', C.c_int, D, C.c_int)
bind(X, 'XDisplayHeight', C.c_int, D, C.c_int)
bind(X, 'XCreateSimpleWindow', W, D, W, C.c_int, C.c_int, C.c_uint, C.c_uint, C.c_uint, W, W)
bind(X, 'XChangeWindowAttributes', C.c_int, D, W, W, C.POINTER(Attributes))
bind(X, 'XCreateGC', D, D, W, W, D)
bind(X, 'XCreateImage', D, D, D, C.c_uint, C.c_int, C.c_int, D, C.c_uint, C.c_uint, C.c_int, C.c_int)
bind(X, 'XPutImage', C.c_int, D, W, D, D, C.c_int, C.c_int, C.c_int, C.c_int, C.c_uint, C.c_uint)
bind(X, 'XDestroyImage', C.c_int, D)
bind(X, 'XStoreName', C.c_int, D, W, C.c_char_p)
bind(X, 'XMapRaised', C.c_int, D, W)
bind(X, 'XMoveWindow', C.c_int, D, W, C.c_int, C.c_int)
bind(X, 'XRaiseWindow', C.c_int, D, W)
bind(X, 'XFlush', C.c_int, D)
bind(X, 'XSelectInput', C.c_int, D, W, C.c_long)
bind(X, 'XPending', C.c_int, D)
bind(X, 'XNextEvent', C.c_int, D, C.POINTER(Event))
bind(X, 'XCloseDisplay', C.c_int, D)
bind(X, 'XDestroyWindow', C.c_int, D, W)
bind(X, 'XFreeGC', C.c_int, D, D)
bind(X, 'XGetInputFocus', C.c_int, D, C.POINTER(W), C.POINTER(C.c_int))
bind(S, 'XShapeCombineRectangles', None, D, W, C.c_int, C.c_int, C.c_int, C.POINTER(Rect), C.c_int, C.c_int, C.c_int)
bind(S, 'XShapeGetRectangles', C.POINTER(Rect), D, W, C.c_int, C.POINTER(C.c_int), C.POINTER(C.c_int))
bind(X, 'XFree', C.c_int, D)
bind(libc, 'malloc', D, C.c_size_t)

display = X.XOpenDisplay(os.environ.get('DISPLAY', ':99').encode())
if not display:
    raise RuntimeError('无法连接同一个 X11 桌面；容器需要共享 DSH 的网络命名空间')
screen = X.XDefaultScreen(display)
visual = X.XDefaultVisual(display, screen)
depth = X.XDefaultDepth(display, screen)
if depth != 24:
    raise RuntimeError('本播放器已验证的 X11 桌面深度为 24 位')
width, height = X.XDisplayWidth(display, screen), X.XDisplayHeight(display, screen)
x, y = float(width - size - 32), max(32, height - size - 40)
focus, revert = W(), C.c_int()
X.XGetInputFocus(display, C.byref(focus), C.byref(revert))
window = X.XCreateSimpleWindow(display, X.XDefaultRootWindow(display), int(x), y, size, size, 0, 0, 0)
attrs = Attributes(); attrs.override_redirect = 1
X.XChangeWindowAttributes(display, window, 1 << 9, C.byref(attrs))
X.XStoreName(display, window, b'DSH 2D Avatar Desktop Pet')
X.XSelectInput(display, window, 1 << 15)
gc = X.XCreateGC(display, window, 0, None)
# 输入区域为空：鼠标事件直接交给角色后方的应用，不抢 agent 的焦点。
S.XShapeCombineRectangles(display, window, 2, 0, 0, None, 0, 0, 0)
X.XMapRaised(display, window)
X.XFlush(display)
count, ordering = C.c_int(), C.c_int()
rects = S.XShapeGetRectangles(display, window, 2, C.byref(count), C.byref(ordering))
click_through = count.value == 0
if rects:
    X.XFree(C.cast(rects, D))
after_focus = W(); X.XGetInputFocus(display, C.byref(after_focus), C.byref(revert))
cache = {}


def prepare(name):
    if name in cache:
        return cache[name]
    with Image.open(io.BytesIO(png[name])) as source:
        tile = source.convert('RGBA').resize((size, size), Image.Resampling.LANCZOS)
    raw = tile.convert('RGB').tobytes('raw', 'BGRX')
    pointer = libc.malloc(len(raw))
    if not pointer:
        raise MemoryError('无法分配角色图片')
    C.memmove(pointer, raw, len(raw))
    image = X.XCreateImage(display, visual, depth, 2, 0, pointer, size, size, 32, size * 4)
    if not image:
        raise RuntimeError('无法创建 X11 图片')
    alpha = tile.getchannel('A').tobytes()
    rectangles = []
    for row in range(size):
        start = None
        for col in range(size + 1):
            opaque = col < size and alpha[row * size + col] >= 96
            if opaque and start is None:
                start = col
            elif not opaque and start is not None:
                rectangles.append(Rect(start, row, col - start, 1)); start = None
    array = (Rect * len(rectangles))(*rectangles)
    cache[name] = image, array
    return cache[name]


def choose(action, elapsed):
    clip = manifest['actions'][action]
    total = sum(clip['times'])
    if clip['loop']:
        elapsed %= total
    elif elapsed >= total:
        return clip['files'][-1] if clip.get('hold') else manifest['actions']['idle']['files'][0]
    for name, ms in zip(clip['files'], clip['times']):
        if elapsed < ms:
            return name
        elapsed -= ms
    return clip['files'][-1]


signal.signal(signal.SIGTERM, lambda *_: stop.set())
signal.signal(signal.SIGINT, lambda *_: stop.set())
threading.Thread(target=poll, daemon=True).start()
idle_since, wander_until, wander_start, direction = time.monotonic(), 0, 0, -1
last_phase, last_name, last_report = None, None, 0
next_tick = time.monotonic()
try:
    while not stop.is_set():
        now = time.monotonic()
        exposed = False
        event = Event()
        while X.XPending(display):
            X.XNextEvent(display, C.byref(event))
            exposed = exposed or event.type == 12
        with lock:
            state = latest.copy()
        action, phase = state['action'], state.get('phase', 'idle')
        if phase != last_phase:
            idle_since = now; last_phase = phase; wander_until = 0
        walking = action in ['walk-left', 'walk-right']
        elapsed = max(0, time.time() * 1000 - state.get('startedAt', 0))
        if action == 'idle' and phase == 'idle':
            if not wander_until and now - idle_since > 12:
                direction = -1 if x > width / 2 else 1
                wander_start = now; wander_until = now + random.uniform(5, 8)
            if wander_until and now < wander_until:
                walking = True; action = 'walk-left' if direction < 0 else 'walk-right'; elapsed = (now - wander_start) * 1000
            elif wander_until:
                wander_until = 0; idle_since = now
        if walking:
            direction = -1 if action == 'walk-left' else 1
            x = max(12, min(width - size - 12, x + direction * 3))
            X.XMoveWindow(display, window, int(x), y)
        name = choose(action, elapsed)
        if name != last_name or exposed:
            image, rectangles = prepare(name)
            S.XShapeCombineRectangles(display, window, 0, 0, 0, rectangles, len(rectangles), 0, 0)
            X.XPutImage(display, window, gc, image, 0, 0, 0, 0, size, size)
            last_name = name
        if now - last_report >= 1:
            X.XRaiseWindow(display, window)
            status = {'windowId': int(window), 'x': int(x), 'y': y, 'size': size, 'action': action, 'phase': phase,
                      'clickThrough': click_through, 'focusPreservedOnMap': focus.value == after_focus.value,
                      'source': state.get('source'), 'updatedAt': time.time(), 'fpsCap': 12}
            temporary = Path('/data/desktop-pet.tmp')
            temporary.write_text(json.dumps(status))
            temporary.replace('/data/desktop-pet.json')
            last_report = now
        X.XFlush(display)
        next_tick += 1 / 12
        stop.wait(max(0, next_tick - time.monotonic()))
        if next_tick < time.monotonic() - .5:
            next_tick = time.monotonic()
finally:
    X.XDestroyWindow(display, window)
    for image, _ in cache.values():
        X.XDestroyImage(image)
    X.XFreeGC(display, gc)
    X.XCloseDisplay(display)
