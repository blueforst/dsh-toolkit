#!/bin/bash
set -Eeuo pipefail
# 首次创建配置；用户以后修改的面板、壁纸和快捷方式在 .dsh 卷中保存。
mkdir -p /workspace/桌面 /workspace/下载 "$XDG_CONFIG_HOME" "$XDG_DATA_HOME/applications"
if [[ ! -f "$XDG_CONFIG_HOME/user-dirs.dirs" ]]; then
  cat > "$XDG_CONFIG_HOME/user-dirs.dirs" <<'EOF'
XDG_DESKTOP_DIR="/workspace/桌面"
XDG_DOWNLOAD_DIR="/workspace/下载"
XDG_DOCUMENTS_DIR="/workspace"
EOF
fi
if [[ ! -f "$XDG_CONFIG_HOME/.dsh-desktop-initialized" ]]; then
  gsettings set org.gnome.desktop.interface toolkit-accessibility true
  xfconf-query -c xfce4-session -p /general/SaveOnExit -n -t bool -s false
  xfconf-query -c xfce4-session -p /general/LockCommand -n -t string -s ''
  xfconf-query -c xfce4-session -p /general/EnableAssistiveTechnologies -n -t bool -s true
  touch "$XDG_CONFIG_HOME/.dsh-desktop-initialized"
fi
if [[ ! -f "$XDG_DATA_HOME/applications/dsh-camoufox.desktop" ]]; then
  cat > "$XDG_DATA_HOME/applications/dsh-camoufox.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Camoufox 浏览器
Comment=打开 DSH 管理的持久化浏览器
Exec=/opt/dsh-linux-desktop/open-browser.py
Icon=web-browser
Terminal=false
Categories=Network;WebBrowser;
EOF
fi
if [[ ! -f /workspace/桌面/文件管理器.desktop ]]; then
  cp /usr/share/applications/thunar.desktop /workspace/桌面/文件管理器.desktop
  chmod +x /workspace/桌面/文件管理器.desktop
fi
if [[ ! -f /workspace/桌面/终端.desktop ]]; then
  cp /usr/share/applications/xfce4-terminal.desktop /workspace/桌面/终端.desktop
  chmod +x /workspace/桌面/终端.desktop
fi
if [[ ! -f /workspace/桌面/Camoufox.desktop ]]; then
  cp "$XDG_DATA_HOME/applications/dsh-camoufox.desktop" /workspace/桌面/Camoufox.desktop
  chmod +x /workspace/桌面/Camoufox.desktop
fi
