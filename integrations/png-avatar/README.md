# 大肥鱼：纯 2D 桌宠与直播角色

本配方复用 `YunYueSama/codex-deepseek-pet` 的完整角色图片。固定来源提交、校验 Git blob，离线提取 320 像素小图；运行时不调用图像模型，不使用 Electron、Live2D 骨骼或 WebGL。

默认分工：

```text
8 GB 机：DSH agent → 真实会话事件 → 私网角色服务
        真实 Xfce 桌面 ← X11 桌宠播放器 ← 状态与预制图片
        桌面采集（已包含桌宠）→ 私网原始视频
4 GB 机：角色状态服务 + 按需视频编码 → 内网验收录像
```

桌宠平时眨眼，闲置 12 秒后沿桌面下方小范围走动；思考时托腮、略微歪头，播放一次后保持末帧，直到状态切换。思考、执行工具和回复期间停止自主走动。窗口使用 X11 Shape 的透明轮廓，输入区域为空，不抢焦点，鼠标直接穿透到后面的应用。它没有拖拽、换肤或养成功能。

## 会话状态与 agent 工具

`provider.mjs` 接入 DSH `0.2.2-alpha.2` 的原生 Cordis 接口：

| 真实事件 | 角色状态 |
| --- | --- |
| agent 进入 running、模型流开始 | 思考动作，包含等待模型输出的阶段 |
| `reasoning-delta` | 思考动作 |
| `text-delta` | 回复状态；没有配置 TTS 时不模拟语音或口型 |
| `tool/call` | 执行工具，播放思考动作并停止走动 |
| 回合结束、取消、agent 释放 | 回到待机 |

不读取和转发模型思考正文，只传状态、会话标识和短期租约。同一状态的逐 token 事件不会逐次发送网络请求。15 秒心跳维持 35 秒租约；DSH 退出或失联后服务自动恢复待机。默认由第一个活跃根会话占用角色，其他并发会话和子会话不能抢占；也可在配置中指定 `sessionId`。

agent 可调用：

- `avatar_get_state`：查看当前动作和来源。
- `avatar_set_action`：设置 `idle`、`thinking`、`wave`、`happy`、`sad`、`surprised`、`walk-left`、`walk-right`；`seconds` 为 0.25–30 秒，默认 3 秒。手动动作短暂覆盖自动动作，结束后恢复。

## 在 4 GB 机部署角色服务

将本目录复制到独立部署目录。以下构建与素材处理均在服务器执行：

```bash
docker build -t local/dsh-png-avatar:0.1.0 .
mkdir -p data
sudo chown 1000:1000 data
# 用自己的安全方式创建独立的随机 avatar.token，至少 32 字符。
# 文件归属 1000:1000，权限 0640；不要提交凭据。
docker run --rm --cpus 1 --memory 384m --user 1000:1000 \
  -v "$PWD/data:/data" --entrypoint python3 \
  local/dsh-png-avatar:0.1.0 /app/import-assets.py
AVATAR_BIND_IP=10.0.0.20 docker compose -p dsh-avatar up -d avatar
```

将示例私网地址替换为实际地址。19380 是受独立 Bearer 凭据保护的角色接口；19381 为按需录像的私网媒体入口。不要把这两个端口绑定到公网。角色服务本身上限为 384 MiB / 0.5 核；编码器是独立的按需容器，不受这个 0.5 核配额限制。

素材导入会保留原作者的 `LICENSE`、`ASSET_LICENSE.md` 和改动署名。仓库不打包再分发角色图片，运行素材位于本机 `data/assets`。

## 在 8 GB 机启动真实桌宠

构建同一镜像，准备 `desktop-data/config.json`：

```json
{
  "url": "http://10.0.0.20:19380/",
  "tokenFile": "/run/secrets/avatar_token",
  "size": 240
}
```

`desktop.token` 使用与角色服务相同的独立凭据，归属 1000:1000、权限 0640；`desktop-data` 也需要允许 UID 1000 写入状态文件。然后运行：

```bash
docker compose -f desktop.compose.yml -p dsh-desktop-pet up -d
```

默认共享 `dsh-deepseek-harness-1` 的网络命名空间，通过 Linux 的本地抽象 X11 socket 访问同一个 `:99` 桌面。已验证的环境为 Linux / Xvfb 24 位色深；它不是适用于所有 Wayland、Xorg 或桌面环境的通用安装器。更换 DSH 容器名称时设置 `DSH_CONTAINER`，重新创建 DSH 容器后也应重新创建桌宠容器。

桌宠限制 0.3 核、160 MiB、12 FPS，不安装宿主机软件、不挂载 Docker socket。`desktop-data/desktop-pet.json` 提供实际窗口编号、位置、动作、鼠标穿透和焦点验证结果，便于验收。

## 接入 DSH

将 `provider.mjs` 和 `events.mjs` 放入 DSH 可持久化的集成目录，复用当前 DSH 安装的 `@deepseek-ai/dsh-tools` 依赖。专用 Linux 桌面运行时可把该目录的 `node_modules` 链接到 `/opt/dsh-camoufox/node_modules`。

在 DSH 数据目录中放置权限 0600 的 `avatar/config.json`：

```json
{
  "url": "http://10.0.0.20:19380/",
  "tokenFile": "/home/node/.dsh/avatar/token"
}
```

对应 token 文件同样为 0600。将 `web.cordis.patch.yml` 合并到现有 profile，或作为额外 `--patch` 加载，二者选其一。保留现有配置并先备份，重启后确认工具发现和服务健康。

预览地址是当前 DSH 网站的 `/avatar/`，继承 DSH 登录与来源检查。浏览器不接触私网角色控制密钥；代理只开放必要的页面、状态、预制图片和验收录像，不代理原始 RGBA 流。

## 内网录制与验证

接收端先执行：

```bash
AVATAR_CAPTURE_SECONDS=30 docker compose --profile capture -p dsh-avatar run --rm encoder
```

再在 8 GB 机的桌面容器中运行 `capture-desktop.sh`，指定 `AVATAR_RECEIVER` 为接收端私网 IPv4。脚本按默认 1440×900 桌面采集，完整缩放并留边到 1920×1080 / 30 FPS。接收端以 x264 veryfast / 6 Mbps 编码。

默认桌面已包含真实桌宠，编码端不重复叠加。只有未运行桌宠、确实需要固定的直播画面叠加时才设置 `AVATAR_OVERLAY=1`。当前验收采集使用静音轨道，没有配置桌面音频采集、TTS、直播平台地址或推流密钥；录像不等于已在平台开播。

角色与编码器运行日志、CPU、内存、完整帧数及停止后的进程都需核对。检查在服务器执行：

```bash
npm run build
npm run check
DSH_ENTRYPOINT=/path/to/dsh/lib/bin.js npm test
python3 scripts/audit-release.py
# DSH 运行时内：原生工具与事件总线隔离验收，无模型请求。
DSH_AVATAR_ISOLATED_TEST=1 node integrations/png-avatar/acceptance.mjs
```

`ui-acceptance.mjs` 使用受保护的临时凭据文件检查真实页面；只有显式设置 `DSH_AVATAR_LIVE_MODEL_TEST=1` 才发送一条真实模型测试消息。凭据不写日志，脚本结束后删除临时文件。

## 停用和回滚

停止桌宠不会停止 DSH：`docker compose -f desktop.compose.yml -p dsh-desktop-pet down`。停止角色服务：`docker compose -p dsh-avatar down`。移除新增 profile 行或恢复备份并重启 DSH，即可撤销工具和自动联动。不要删除原有会话、浏览器数据或其他 profile。

## 素材来源

作者：YunYueSama；原仓库：<https://github.com/YunYueSama/codex-deepseek-pet>。本配方锁定提交 `7661c8b304c5400701f91da01b1a643a207331de`，提取、缩小部分整身帧，增加走路镜像，选用托腮、歪头姿势并保持思考末帧。

原作者对其有权授权的新增贡献采用自定义署名许可，允许署名使用和商用；社区参考图、角色设计等第三方权利不因此额外授予。实际使用须保留随素材下载的完整声明。本配方代码使用项目现有 MIT 许可。
