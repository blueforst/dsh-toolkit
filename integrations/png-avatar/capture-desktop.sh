#!/bin/bash
# 在 8 GB 桌面容器内按需运行；接收端必须先启动。默认只有静音轨道。
set -Eeuo pipefail
: "${AVATAR_RECEIVER:?请指定接收端私网 IPv4}"
seconds="${AVATAR_CAPTURE_SECONDS:-30}"
if ! [[ "$AVATAR_RECEIVER" =~ ^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)[0-9.]+$ ]]; then
  echo '只允许发送到私网地址' >&2; exit 1
fi
if ! [[ "$seconds" =~ ^[0-9]+$ ]] || ((seconds < 1 || seconds > 300)); then
  echo '验收采集时长应在 1–300 秒之间' >&2; exit 1
fi
exec ffmpeg -hide_banner -nostdin -loglevel warning -f x11grab -draw_mouse 1 \
  -framerate 30 -video_size 1440x900 -i "${DISPLAY:-:99}.0" \
  -f lavfi -i anullsrc=r=48000:cl=stereo \
  -vf 'scale=1728:1080:flags=fast_bilinear,pad=1920:1080:96:0' \
  -c:v rawvideo -threads 1 -pix_fmt yuv420p -c:a pcm_s16le -t "$seconds" \
  -flush_packets 1 -f nut "tcp://${AVATAR_RECEIVER}:19381?tcp_nodelay=1"
