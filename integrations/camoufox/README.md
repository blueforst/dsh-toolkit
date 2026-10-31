# Camoufox 指纹浏览器接入

本目录提供已部署运行时的可复用配方。DSH 的“浏览器桌面”入口使用上游 `@runzhliu/dsh-browser-desktop`；本仓库自编部分是持久浏览器启动器、MCP 桥接和 Browser Use provider。

## 固定版本

| 组件 | 版本 |
| --- | --- |
| DSH 镜像 | `0.2.2-alpha.2-r1`，Dockerfile 中固定 digest |
| Camoufox 启动器 | `0.5.9-beta.6` |
| 浏览器资源 | `158.0.1-beta.41`，大小和 SHA256 固定 |
| Playwright | `1.62.0` |
| Playwright MCP | `0.0.78` |
| MCP SDK | `1.25.2` |

启动器与浏览器资源必须配对。构建脚本会核对 pin，流式下载官方资源，校验大小、SHA256、剩余空间和解包路径。资源约 1.3 GB，构建应在服务器执行。仓库和 Release 不含浏览器二进制。

## 结构

- `launch.mjs`：持久化配置目录与设备预设，重启保持同一预设。
- `broker.mjs`：共享可见浏览器及 Playwright MCP，监听容器回环地址 `9222`。
- `mcp-proxy.mjs`：把会话 stdio MCP 转发到共享浏览器 broker。
- `provider.mjs`：通过 DSH 的 `mountSessionMcp()` 实现独占、工具归属和释放。
- `entrypoint.sh`：启动 Xvfb、Openbox、VNC、noVNC 和浏览器，再启动 DSH。
- `web.cordis.patch.yml`：启用浏览器服务、provider 与桌面入口；默认使用公网 HTTPS 443 的 noVNC 反代路径。

`/json/new` 和 `/json/activate` 只兼容桌面入口的打开与激活动作；这是 Firefox/Playwright 运行时，不提供完整 Chromium CDP 协议。

## 部署示例

在仓库根目录执行，先把下载的统一包放入 `dist/`：

```bash
cp integrations/camoufox/.env.example integrations/camoufox/.env
# 编辑 .env，设置自己的访问域名和可选 Go 密钥
docker compose --env-file integrations/camoufox/.env -f integrations/camoufox/compose.yml config
docker compose --env-file integrations/camoufox/.env -f integrations/camoufox/compose.yml up -d --build
docker compose --env-file integrations/camoufox/.env -f integrations/camoufox/compose.yml exec -T dsh \
  dsh plugin --profile web add --ignore-scripts --save-exact /opt/dsh-toolkit-dist/forst-dsh-toolkit-0.1.0.tgz
docker compose --env-file integrations/camoufox/.env -f integrations/camoufox/compose.yml restart dsh
```

DSH 认证与 TLS 证书按部署环境配置。本配方把 Web 和 noVNC 端口绑定到宿主回环地址，通过 Nginx 同源转发。

参考 [Nginx 示例](nginx.example.conf)，修改域名、证书路径和端口。该示例使用公网 Basic 登录保护全部 Web、noVNC 与 WebSocket 路由，并在根页代理时携带 DSH 原生 bootstrap token：

1. 用 `htpasswd -c /etc/nginx/dsh-toolkit.htpasswd YOUR_USERNAME` 创建公网登录，密码交互输入。
2. 从自己 DSH 的启动地址取得 `token` 参数，填写 [bootstrap 配置模板](bootstrap.example.conf)，保存为 `/etc/nginx/snippets/dsh-toolkit-bootstrap.conf`，权限设为 `0600`。
3. 先执行 `nginx -t`，再按既有部署方式启用配置。确认未登录的根页、noVNC 和 WebSocket 均被拒绝。

示例访问日志不记录查询参数。bootstrap token 是 DSH 的原生凭据，公网 Basic 登录是另一层入口保护；MCP 与 VNC 原始端口保持容器内部。

重启 DSH 后，如果新启动地址的 token 变化，要同步更新私有 bootstrap 配置并重新加载 Nginx；不要继续使用旧启动 token。

部署完成后，按根目录说明安装整机采样服务。此 Compose 的网络默认名是 `dsh-toolkit-demo_default`。

持久数据分别在命名卷 `dsh-home` 和根目录 `workspace/`。修改 `DSH_PUBLIC_HOST` 后，需要同步修改 Nginx 域名并重启。浏览器桌面默认 `desktopPort: 443`，如使用其他公网端口，要相应修改 patch。

浏览器兼容性以目标网站和版本的实际测试为准。客户端代理、DNS 和 Clash 规则由部署环境管理。
