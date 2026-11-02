# Linux 完整桌面与 DSH Computer Use

本配方在 [Camoufox 运行时](../camoufox/README.md) 上增加 Xfce：应用菜单、面板、文件管理器、终端与 Mousepad 文本编辑器。人工仍通过 DSH 的内嵌 noVNC 桌面操作；模型通过 **DSH 官方 Cua Driver MCP provider** 操作同一个 X11 会话。

## 接入方式与边界

调用链为 `DSH tools → 官方 computer-use provider → cua-driver MCP → X11 / AT-SPI → Xfce 应用`。这与仅能操作网页的 Playwright MCP 分开。现有 Browser Use、Camoufox 登录数据、设备预设和三十分钟闲置回收保留。

DSH `0.2.2-alpha.2` 的 `dsh-cua-bundle` 原生对象接口仅支持 macOS，不能在 Linux 上启用这个开关就得到桌面控制。本配方使用同版本官方 `dsh-experimental-computer-use-cua-driver-mcp`，工具名称为 `mcp__cua-driver-mcp__<工具名>`，不宣称提供 macOS 的 `cua.getApp()` 接口。

- 固定基础：已有 Camoufox 镜像、DSH `0.2.2-alpha.2`。
- 固定驱动：Cua Driver `0.28.0`，Linux x86_64 发布归档，大小和 SHA256 见 [assets.json](assets.json)。目前只提供此架构的配方，其他架构会明确失败。
- 官方 provider 从 npm 下载，验证 SHA512，复用基础镜像中的 Cordis 与 MCP 依赖，不安装第二份 DSH。
- Xfce 和应用来自基础镜像的 Debian 软件源，软件包版本随构建时仓库变化；镜像构建结果需单独保留。
- Xvfb、Xfce、驱动和 DSH 以同一个非 root 用户运行，共享同一 D-Bus 会话及 AT-SPI 无障碍总线。
- 仅绑定现有宿主回环端口，由原 Nginx 的 HTTPS 和登录保护 noVNC。不得把裸 VNC、MCP 或未认证 Web 端口暴露到公网。

## 构建与启用

在服务器执行。先构建 Camoufox 基础镜像，然后合并 Compose：

```bash
docker compose --env-file integrations/camoufox/.env \
  -f integrations/camoufox/compose.yml build
docker compose --env-file integrations/camoufox/.env \
  -f integrations/camoufox/compose.yml \
  -f integrations/linux-desktop/compose.override.yml config --quiet
docker compose --env-file integrations/camoufox/.env \
  -f integrations/camoufox/compose.yml \
  -f integrations/linux-desktop/compose.override.yml build
# 先完成下文的隔离验收，再切换现有服务。
docker compose --env-file integrations/camoufox/.env \
  -f integrations/camoufox/compose.yml \
  -f integrations/linux-desktop/compose.override.yml up -d --no-build
```

Compose 的相对路径按照第一个配置文件解析，扩展使用 `integrations/` 为构建上下文。若基于另一份已验证镜像构建，设置 `DSH_CAMOUFOX_IMAGE`。已有服务名不是 `dsh` 时，先把 override 中服务名改为对应名称；保留原项目名称与持久卷。

完整桌面默认允许最多 `6g` 物理内存、`7g` 内存与 swap 总量，适合约 8 GB 的宿主机。它只提高使用上限，不预占内存；宿主机需另外配置 swap。其他容量的服务器应通过 `DSH_DESKTOP_MEMORY_LIMIT` 和 `DSH_DESKTOP_MEMORY_SWAP_LIMIT` 调整，并给宿主系统留出余量。

已有部署可将 [web.cordis.patch.yml](web.cordis.patch.yml) 中的 `insert` 条目合并到原 patch。不要覆盖模型路由、浏览器配置或用户配置。只启用一个 Computer Use provider。标准 Web 组合需提供 tools、system-prompt、附件存储等基础服务。

使用社区镜像的入口脚本时，所有 `--patch 路径` 必须紧接 `web` 放在 `--no-open`、`--trusted-host` 等 CLI 参数之前；不要把新 patch 直接追加到原命令末尾。

模型路由必须真实支持并声明图像输入，才能用截图识别桌面。纯文本路由仍可能调用无障碍树和动作，但收到图片不可用诊断；不能仅把能力配置改成支持图片，就认为底层模型已经支持。多个聊天共享一个桌面，按顺序执行桌面任务。

## 使用与数据

- 原“浏览器桌面”入口在此镜像中显示为“桌面”，使用显示器图标，点开完整桌面；弹窗标题、提示和无障碍标签同步调整。
- “桌面”和“下载”目录分别位于 `/workspace/桌面`、`/workspace/下载`。
- Xfce 配置与用户应用快捷方式位于 `/home/node/.dsh/linux-desktop/`，随现有 `.dsh` 卷持久化。
- 浏览器快捷方式调用已有 broker 打开 `about:blank`，沿用唯一的持久配置档。
- 完整桌面默认设置 `DSH_BROWSER_DESKTOP_WAKE_ENABLED=0`，使用终端和文件管理器不会自动启动浏览器。通过快捷方式、DSH 桌面打开 URL 或 Browser Use 工具仍能启动它。
- 浏览器已启动后，桌面键鼠操作仍保护其不被误回收，连续闲置三十分钟后回收。桌面会话本身保持运行。

Linux 驱动支持范围以 [Cua Driver Linux 文档](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.0/libs/cua-driver/rust/Skills/cua-driver/LINUX.md) 为准。Xvfb 不具备真实 Xorg 的所有后台像素输入能力；优先使用 AT-SPI 元素操作。前台输入用于本专用桌面的已授权工作流，不可把驱动的拒绝静默当作成功。

## 验收与回滚

先用独立 `.dsh`、工作目录和回环端口启动隔离实例；不得用测试覆盖生产数据。验证：

1. Xfce 面板、文件管理器、终端和文本编辑器均能启动，noVNC 显示同一桌面。
2. `cua-driver doctor`、MCP 工具发现、应用和窗口枚举正常。
3. 使用真实 MCP 完成编辑器输入、读取状态、保存文件，并核对保存内容和截图。
4. 在 DSH 中发现 `mcp__cua-driver-mcp__` 工具并验证官方桥接；截图投影需用支持图像的真实模型或隔离测试路由单独验证。
5. Browser Use 的按需启动、持久身份、显式释放仍正常；仅操作其他桌面应用不唤醒浏览器。
6. 重建后桌面文件和配置保留；生产 Web、noVNC 和 WebSocket 仍受原认证保护。

真实工具与浏览器验收脚本均要求显式指定隔离实例：

```bash
docker exec -i -e DSH_DESKTOP_ISOLATED_TEST=1 TEST_CONTAINER node --input-type=module \
  < integrations/linux-desktop/acceptance.mjs
docker exec -i -e DSH_DESKTOP_ISOLATED_TEST=1 TEST_CONTAINER node --input-type=module \
  < integrations/linux-desktop/browser-smoke.mjs
docker exec -i -e DSH_DESKTOP_ISOLATED_TEST=1 -e DSH_DESKTOP_VISION_TEST=1 TEST_CONTAINER node --input-type=module \
  < integrations/linux-desktop/acceptance.mjs
```

编辑器验收会创建专用文件，通过 DSH 官方工具执行器完成输入、独立状态读回、保存与正常退出。首次运行需使用干净的测试会话，避免干扰其他程序。`ui-acceptance.mjs` 另验证按钮、弹窗和 noVNC；隔离实例的 bootstrap 地址需私下写入容器 `/tmp/dsh-desktop/test-bootstrap-url`。已有 HTTPS/Basic 入口可通过 `DSH_DESKTOP_TEST_AUTH_FILE` 指定容器内权限为 `0600` 的 JSON 文件，字段为 `url`、`username`、`password`；该模式只检查界面，不发送聊天或桌面键鼠输入，测试后删除凭据文件。不要把这些凭据加入仓库或输出日志。

切换前备份 Compose、patch、旧镜像标识和 `.dsh` 卷。切换会重启 DSH，打开的网页和未保存窗口不会自动恢复。回滚时恢复原 Compose 和 patch，使用保留的旧镜像重建服务；不删除 `.dsh` 或工作目录。

上游说明：[DSH 官方 provider](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-alpha.2/packages/experimental/computer-use-cua-driver-mcp/README.zh.md)、[驱动发布](https://github.com/trycua/cua/releases/tag/cua-driver-rs-v0.28.0)。
