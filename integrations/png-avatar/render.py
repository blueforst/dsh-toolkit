"""按需录制内网真实桌面，保留原版角色画面；不向外部平台发送数据。"""
import os
import subprocess

duration = int(os.environ.get('AVATAR_CAPTURE_SECONDS', '30'))
if not 1 <= duration <= 300:
    raise SystemExit('内网验收录像限制在 1–300 秒')
command = ['ffmpeg', '-hide_banner', '-nostdin', '-loglevel', 'warning', '-threads', '2',
    '-thread_queue_size', '4', '-analyzeduration', '100000', '-probesize', '65536', '-f', 'nut', '-i', 'tcp://0.0.0.0:19381?listen=1&listen_timeout=20000']
command += ['-map', '0:v:0']
command += ['-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-threads', '2',
    '-b:v', '6000k', '-minrate', '6000k', '-maxrate', '6000k', '-bufsize', '12000k', '-g', '60', '-sc_threshold', '0',
    '-x264-params', 'nal-hrd=cbr:force-cfr=1', '-c:a', 'aac', '-b:a', '128k', '-t', str(duration),
    '-movflags', '+faststart', '-y', '/data/preview.mp4']
try:
    subprocess.run(command, check=True, timeout=duration + 45)
except subprocess.TimeoutExpired:
    raise SystemExit('桌面采集超时，已停止录制')
