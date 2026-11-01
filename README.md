# DSH Toolkit

把经过实际部署的 DSH 定制整理成一个可复用插件包：**服务器资源、OpenCode Go 月额度、Pi 会话费用**。另附 **Camoufox 指纹浏览器运行时**及 **OpenCode Go 模型配置示例**。

源码与版本包：[blueforst/dsh-toolkit](https://github.com/blueforst/dsh-toolkit) · [下载发布包](https://github.com/blueforst/dsh-toolkit/releases)

[定制组件清单](docs/插件清单.md) · [验收记录](docs/验收记录.md)

## 包含什么

| 组件 | 功能与位置 | 刷新方式 |
| --- | --- | --- |
| 服务器资源 | 侧边栏“浏览器桌面”上方：CPU、内存、硬盘进度条 | 1 秒 |
| OpenCode Go 月额度 | “浏览器桌面”下方、“更多”上方：名称、整数百分比、本月已使用 | 60 秒；服务端共享 60 秒缓存 |
| Pi 会话费用 | 输入框统计行最前面：费用图标与总价；悬停高亮，点击展开原生风格浮窗 | 随会话结算推送 |
| Camoufox 接入配方 | 持久化设备预设和浏览器数据、可见桌面、MCP 浏览器工具、会话独占、按需启动及闲置回收 | 可选 Docker 运行时 |

四条进度条统一配色：≤70% 蓝色；>70% 且 ≤90% 黄色；>90% 红色；不可用为灰色。侧栏折叠、页面不可见时暂停刷新；恢复时立即读取。

费用浮窗只列“输入、输出、缓存读”，累计实际产生缓存写费用时才增加“缓存写”。复用当前 DSH 安装的 Pi 目录及 `calculateCost()`，支持刷新、换会话和完整历史回算，不安装第二份 Pi，不修改 DSH 核心。

## 兼容环境

- 已验证基线：DSH `0.2.2-alpha.2`、Node.js `24.22.1`、Pi `1.4.0`；Node 最低 `24.9`。
- 资源采集器适用于有 `/proc` 的 Linux；内存按整机 `MemAvailable` 计算。
- Web UI 使用原生 Cordis、会话投影和客户端扩展点。其他 DSH 版本需要重新验证。
- 浏览器运行时版本、来源和限制见 [Camoufox 说明](integrations/camoufox/README.md)。

## 安装一个插件包

在运行 DSH 的环境中执行：

```bash
curl -fL -o forst-dsh-toolkit-0.1.1.tgz \
  https://github.com/blueforst/dsh-toolkit/releases/download/v0.1.1/forst-dsh-toolkit-0.1.1.tgz
dsh plugin --profile web add --ignore-scripts --save-exact "$PWD/forst-dsh-toolkit-0.1.1.tgz"
```

随后重启运行该 `web` profile 的 DSH 进程。保留下载包的位置，便于后续重新安装。

如果原来分别装了 `@forst/dsh-server-metrics` 或 `@forst/dsh-session-billing`，先备份 profile 的 `package.json`、`pnpm-lock.yaml`、`cordis.yml`、`cordis.patch.yml`，移除旧插件后再安装统一包：

```bash
dsh plugin --profile web remove @forst/dsh-server-metrics @forst/dsh-session-billing
```

仅移除实际安装的旧包即可；不要同时启用新旧入口，以免重复显示。安装器使用 DSH 原生插件管理，不直接改写用户 Cordis 配置。

## 启用整机资源采集

下载并解压 Release 的源码归档，进入目录。在 Docker 宿主机运行：

```bash
# 改成 DSH 实际使用的 Docker 网络名称
sudo python3 scripts/install-host-metrics.py --network YOUR_PROJECT_default --dry-run
sudo python3 scripts/install-host-metrics.py --network YOUR_PROJECT_default
```

采样服务名为 `dsh-toolkit-metrics.service`，以 `nobody` 运行，只绑定所选私有网桥。插件在 Docker 内默认连接网桥的 `9191` 端口。

原生非 Docker 部署可指定 `--bind 127.0.0.1`，并把 `DSH_METRICS_URL=http://127.0.0.1:9191/metrics` 加入 DSH 启动环境。自定义端口、磁盘路径、安装与移除方法见 [部署说明](docs/部署说明.md)。

## 启用 OpenCode Go

把自己的 `OPENCODE_GO_API_KEY` 加入 DSH 的进程环境，月额度即可读取。Compose 或 systemd 部署应修改相应服务环境并重启；只在另一个终端执行 `export` 不会改变已运行服务的环境。

模型接入示例在 [examples/opencode-go.cordis.patch.yml](examples/opencode-go.cordis.patch.yml)，默认 `deepseek-v4.1-flash / Max`。这是配置示例，需合并进现有配置；不要覆盖原文件。凭据始终通过环境变量引用。

Go 接口当前返回整数百分比，不补小数位。没有密钥、请求失败或尚无有效样本时，额度条显示不可用；其他资源条独立更新。

## 费用口径

费用为 **当前安装的 Pi 模型目录估算**，不是 Go 实际额度或额外账单。Pi 目录不一定包含供应商的时段加价、套餐加权和历史价格；没有目录匹配的调用会标记未计价，不当作免费。

统计完整会话日志中有用量记录的模型结算，包括重试与压缩；无用量记录的辅助请求不在金额内，子会话分别统计。输入、输出、缓存读、缓存写是互斥计费桶，推理 token 已包含在输出中。详见 [费用说明](docs/费用说明.md)。

## 从源码打包与检查

构建和测试放到服务器或 CI 执行：

```bash
npm run build
npm run check
DSH_ENTRYPOINT="$(npm root -g)/@deepseek-ai/dsh/lib/bin.js" npm test
python3 scripts/audit-release.py
npm pack --pack-destination dist
```

统一客户端由两个独立模块的源码生成，不依赖额外打包器。GitHub Actions 会在固定 DSH 基线上执行构建与回归检查。包内无账户数据、会话日志或浏览器配置档。

## 卸载

```bash
dsh plugin --profile web remove @forst/dsh-toolkit
```

重启 DSH。若同时移除宿主采集器，执行 [部署说明](docs/部署说明.md) 中的卸载命令。历史会话无需删除。

## 授权与来源

自编插件和接入脚本按 MIT 授权；第三方运行时、浏览器和上游插件保留各自授权。详见 [NOTICE.md](NOTICE.md)。
