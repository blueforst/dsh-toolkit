#!/bin/bash
set -Eeuo pipefail
export DISPLAY=:99
export XDG_RUNTIME_DIR=/tmp/dsh-runtime
export XDG_CACHE_HOME=/tmp/dsh-desktop-cache
mkdir -p "$XDG_RUNTIME_DIR" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME" \
  /tmp/dsh-desktop /tmp/role-camoufox-fontconfig
chmod 700 "$XDG_RUNTIME_DIR"
printf '%s' "$DBUS_SESSION_BUS_ADDRESS" > /tmp/dsh-desktop/session-bus-address
pids=()
stop() {
  trap - TERM INT EXIT
  if ((${#pids[@]})); then
    kill -TERM "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi
}
trap stop TERM INT EXIT
Xvfb "$DISPLAY" -screen 0 "${DSH_DESKTOP_GEOMETRY:-1440x900x24}" -ac -nolisten tcp > /tmp/dsh-desktop/xvfb.log 2>&1 &
pids+=("$!")
for attempt in {1..80}; do
  if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then break; fi
  sleep 0.1
done
xdpyinfo -display "$DISPLAY" >/dev/null
/opt/dsh-linux-desktop/configure-session.sh
xfce4-session > /tmp/dsh-desktop/xfce.log 2>&1 &
pids+=("$!")
x11vnc -display "$DISPLAY" -forever -shared -repeat -noxdamage -rfbport 5900 -localhost -nopw > /tmp/dsh-desktop/x11vnc.log 2>&1 &
pids+=("$!")
websockify --web=/usr/share/novnc 6080 127.0.0.1:5900 > /tmp/dsh-desktop/novnc.log 2>&1 &
pids+=("$!")
XDG_CACHE_HOME=/opt/dsh-camoufox/cache node /opt/dsh-camoufox/broker.mjs > /tmp/dsh-desktop/broker.log 2>&1 &
pids+=("$!")
for attempt in {1..120}; do
  if curl -fsS http://127.0.0.1:9222/health >/dev/null 2>&1; then break; fi
  kill -0 "${pids[-1]}" || exit 1
  sleep 0.5
done
curl -fsS http://127.0.0.1:9222/health >/dev/null
if [[ -n "${DSH_PUBLIC_HOST:-}" ]]; then
  set -- "$@" --trusted-host "$DSH_PUBLIC_HOST"
fi
/usr/local/bin/deepseek-harness-entrypoint "$@" &
pids+=("$!")
wait -n "${pids[@]}"
