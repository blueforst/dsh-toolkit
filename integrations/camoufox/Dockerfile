FROM ghcr.io/runzhliu/deepseek-harness:0.2.2-alpha.2-r1@sha256:8cbd24d0cf0d26e5fdcd1b310e1a95e95bfc6c4d708784b08f142bd5740134bf
USER root
ENV XDG_CACHE_HOME=/opt/dsh-camoufox/cache \
    DSH_DESKTOP_ENABLED=0 \
    DSH_BROWSER_USE_ENABLED=0
WORKDIR /opt/dsh-camoufox
COPY package.json ./
COPY assets.json install-assets.py ./
COPY package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && ./node_modules/.bin/playwright-core install-deps firefox \
    && python3 install-assets.py \
    && node --input-type=module -e "import {ensureModel,Generator} from 'fpgen-js'; await ensureModel(); new Generator().generate({browser:'Firefox',os:'Linux'});" \
    && ln -s /tmp/role-camoufox-fontconfig cache/camoufox/fontconfig \
    && mv cache/fpgen cache/camoufox/fpgen \
    && chmod -R a+rX cache \
    && ln -s /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai node_modules/@deepseek-ai \
    && rm -rf /var/lib/apt/lists/* /root/.npm
COPY launch.mjs broker.mjs mcp-proxy.mjs ./
COPY provider.mjs ./provider.mjs
COPY web.cordis.patch.yml /opt/deepseek-harness/web.camoufox.patch.yml
COPY entrypoint.sh /usr/local/bin/dsh-camoufox-entrypoint
WORKDIR /workspace
USER node
ENTRYPOINT ["/usr/bin/tini", "--", "/bin/bash", "/usr/local/bin/dsh-camoufox-entrypoint"]
CMD ["web", "--patch", "/opt/deepseek-harness/web.camoufox.patch.yml", "--no-open"]
