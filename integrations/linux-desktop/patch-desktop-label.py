#!/usr/bin/env python3
"""仅在完整桌面镜像中调整上游入口文案；源格式改变时停止构建。"""
from pathlib import Path

client = Path("/opt/deepseek-harness/plugins/dsh-browser-desktop/client.js")
source = client.read_text()
replacements = {
    "browser: zh ? '浏览器桌面' : 'Browser desktop'": "browser: zh ? '桌面' : 'Desktop'",
    "browserDialog: zh ? '浏览器桌面 · 人工接管' : 'Browser desktop · Human takeover'": "browserDialog: zh ? '桌面 · 人工接管' : 'Desktop · Human takeover'",
    "browserFrame: zh ? '容器 Chromium 桌面' : 'Container Chromium desktop'": "browserFrame: zh ? 'Linux 桌面' : 'Linux desktop'",
    "openTitle: zh ? '打开浏览器桌面并人工接管' : 'Open browser desktop for human takeover'": "openTitle: zh ? '打开桌面并人工接管' : 'Open desktop for human takeover'",
    "resize: zh ? '调整浏览器窗口大小' : 'Resize browser window'": "resize: zh ? '调整桌面窗口大小' : 'Resize desktop window'",
    "}, '🌐')": "}, '🖥️')",
}
for old, new in replacements.items():
    if source.count(old) != 1:
        raise RuntimeError(f"上游桌面入口格式改变，需要重新核对：{old}")
    source = source.replace(old, new)
client.write_text(source)
print("完整桌面入口已更新为：桌面")
