#!/usr/bin/env python3
"""仅读取 X11 闲置毫秒数，不读取或记录键鼠内容。"""
import ctypes as c
import os


class Info(c.Structure):
    _fields_ = [('window', c.c_ulong), ('state', c.c_int), ('kind', c.c_int),
                ('since', c.c_ulong), ('idle', c.c_ulong), ('event_mask', c.c_ulong)]


x11 = c.CDLL('libX11.so.6')
xss = c.CDLL('libXss.so.1')
x11.XOpenDisplay.argtypes = [c.c_char_p]
x11.XOpenDisplay.restype = c.c_void_p
x11.XDefaultRootWindow.argtypes = [c.c_void_p]
x11.XDefaultRootWindow.restype = c.c_ulong
x11.XCloseDisplay.argtypes = [c.c_void_p]
xss.XScreenSaverQueryInfo.argtypes = [c.c_void_p, c.c_ulong, c.POINTER(Info)]
display = x11.XOpenDisplay(os.environ.get('DISPLAY', ':99').encode())
if not display:
    raise RuntimeError('无法连接 X11 桌面')
try:
    info = Info()
    if not xss.XScreenSaverQueryInfo(display, x11.XDefaultRootWindow(display), c.byref(info)):
        raise RuntimeError('无法读取 X11 闲置时间')
    print(info.idle)
finally:
    x11.XCloseDisplay(display)
