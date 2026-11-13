# 先构建 ../camoufox 配方，或显式传入已验证的 Camoufox 基础镜像。
ARG DSH_CAMOUFOX_IMAGE=local/dsh-toolkit-camoufox:0.2.2-rc.2
FROM ${DSH_CAMOUFOX_IMAGE}
USER root
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       xfce4 xfce4-terminal mousepad dbus-x11 at-spi2-core \
       libatk-bridge2.0-0 gsettings-desktop-schemas xdg-user-dirs \
       fonts-noto-cjk ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/dsh-linux-desktop
COPY linux-desktop/assets.json linux-desktop/install-assets.py ./
RUN python3 install-assets.py \
    && chmod 755 driver/cua-driver \
    && ln -s /opt/dsh-linux-desktop/driver/cua-driver /usr/local/bin/cua-driver \
    && cua-driver --version
COPY linux-desktop/entrypoint.sh linux-desktop/configure-session.sh linux-desktop/open-browser.py linux-desktop/patch-desktop-label.py ./
COPY linux-desktop/web.cordis.patch.yml /opt/deepseek-harness/web.linux-desktop.patch.yml
COPY camoufox/broker.mjs camoufox/lifecycle.mjs /opt/dsh-camoufox/
RUN chmod 755 entrypoint.sh configure-session.sh open-browser.py \
    && python3 patch-desktop-label.py
ENV DSH_BROWSER_DESKTOP_WAKE_ENABLED=0 \
    XDG_SESSION_TYPE=x11 \
    XDG_CURRENT_DESKTOP=XFCE \
    XDG_SESSION_DESKTOP=xfce \
    XDG_CONFIG_HOME=/home/node/.dsh/linux-desktop/config \
    XDG_DATA_HOME=/home/node/.dsh/linux-desktop/data \
    NO_AT_BRIDGE=0
WORKDIR /workspace
USER node
ENTRYPOINT ["/usr/bin/tini", "--", "/bin/bash", "-c", "mkdir -p /tmp/dsh-runtime && chmod 700 /tmp/dsh-runtime && export XDG_RUNTIME_DIR=/tmp/dsh-runtime && exec /usr/bin/dbus-run-session -- /bin/bash /opt/dsh-linux-desktop/entrypoint.sh \"$@\"", "--"]
CMD ["web", "--patch", "/opt/deepseek-harness/web.linux-desktop.patch.yml", "--no-open"]
