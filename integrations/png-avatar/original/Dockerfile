ARG DSH_DESKTOP_IMAGE=local/dsh-linux-desktop:0.1.2-cua0.28.0
FROM ${DSH_DESKTOP_IMAGE}
USER root
RUN mkdir -p /opt/avatar-electron && cd /opt/avatar-electron \
    && npm install --save-exact --no-audit --no-fund electron@43.7.6 \
    && npm cache clean --force
RUN node /opt/avatar-electron/node_modules/electron/install.js \
    && npm install --prefix /opt/avatar-electron --save-exact --no-audit --no-fund sharp@0.35.4 pngjs@7.0.0 \
    && test -x /opt/avatar-electron/node_modules/electron/dist/electron
COPY native-main.cjs webgl-compat.js /opt/avatar-bridge/
ENV HOME=/data/home XDG_CONFIG_HOME=/data/config XDG_CACHE_HOME=/data/cache \
    XDG_RUNTIME_DIR=/tmp/avatar-runtime
USER node
ENTRYPOINT ["/bin/bash", "-c", "mkdir -p /tmp/avatar-runtime /data/home && chmod 700 /tmp/avatar-runtime && exec dbus-run-session -- /opt/avatar-electron/node_modules/.bin/electron --no-sandbox --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist --disable-background-timer-throttling --disable-renderer-backgrounding --disable-frame-rate-limit --disable-gpu-vsync /opt/avatar-bridge/native-main.cjs"]
