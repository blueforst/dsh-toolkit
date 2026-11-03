# 大肥鱼：原版完整动画与 DSH 桌宠

本配方完整复用 `YunYueSama/codex-deepseek-pet` 固定版本的运行文件与播放器，保留 38 个原生动作、整身运动场插值、动作过渡、转身、起步、刹车及步态与位移同步。不再使用手选少数姿势、缩小素材或 12 FPS 图片轮播。

## 组成与边界

- 8 GB 机：原版 Electron 43.7.6 程序和真实 Linux 桌面。`motion.js`、`flow.js`、`app.js`、行为、物理、步态模块均保持上游原始字节。
- 4 GB 机：私网状态租约、受保护的原版文件服务，以及按需视频编码。
- DSH 接入层：把真实会话事件交给原版行为仲裁器，保留会话占用、取消与失联恢复，不读取或传递思考正文。
- Linux 适配层：更换宿主入口、关闭后台降频、允许软件 WebGL，并提供状态诊断。默认鼠标穿透。Windows 专用的前台窗口探测和窗口边缘探测未启用；这些接口不影响动画模块。

原版目标调度为 60 FPS。没有 GPU 的服务器通过 SwiftShader 执行同一运动场着色器，CPU 和内存成本显著高于旧图片播放器；实际帧率受其他任务争用影响。当前两核无 GPU 实机的走动采样约 28 次实际绘制/秒，侧车占整机约 88% CPU、工作集约 0.9 GiB，不能保证实时 60 FPS，详见[本次验收](../../docs/原版动画验收.md)。若运动场不能启用，宿主拒绝退回图片轮播，浏览器预览也会显示失败。

## 下载与完整性

`original/original-lock.json` 锁定提交 `7661c8b304c5400701f91da01b1a643a207331de` 的 170 个运行及测试文件，共 166,791,670 字节。导入器逐个验证 Git blob，保留原图尺寸和全部原版文件；不会把第三方图片、二进制或源码放入本项目发布包。

导入需要 Python 3 和 Node 20 以上。4 GB 机可直接执行：

```bash
mkdir -p data
AVATAR_ORIGINAL_DIR="$PWD/data/original" python3 original/import-original.py
sudo chown -R 1000:1000 data
```

`DSH-PROVENANCE.json` 是来源锁定记录，`DSH-CLIPS.json` 由原版模块直接导出。生成的 `dsh-index.html`、`dsh-player.html` 和 `dsh-webgl.js` 是适配入口，上游原始文件不被覆盖。

## 启动状态服务

本目录复制到独立部署目录后：

```bash
docker build -t local/dsh-png-avatar:0.2.0 .
# 安全地创建至少 32 字符的独立随机 avatar.token；归属 1000:1000，权限 0640。
AVATAR_BIND_IP=10.0.0.20 docker compose -p dsh-avatar up -d avatar
```

19380 为受 Bearer 凭据保护的接口，19381 为按需录像入口，仅绑定私网地址。服务上限 384 MiB / 0.5 核；编码器另设配额。不要将私网媒体入口绑定公网。

## 启动原版桌宠

先按项目 Linux 桌面配方构建完整桌面镜像，再构建原版宿主：

```bash
docker build -t local/dsh-original-avatar:0.2.0 original
mkdir -p desktop-data
sudo chown 1000:1000 desktop-data
# 可在镜像内运行导入器，宿主无须安装 Node。
docker run --rm --cpus 1 --memory 512m \
  -v "$PWD/original:/recipe:ro" -v "$PWD/desktop-data:/data" \
  --entrypoint python3 local/dsh-original-avatar:0.2.0 /recipe/import-original.py
```

准备 `desktop-data/config.json`，归属 1000:1000、权限 0600：

```json
{
  "url": "http://10.0.0.20:19380/",
  "tokenFile": "/run/secrets/avatar_token",
  "size": 240
}
```

`desktop.token` 使用与状态服务相同的独立凭据，归属 1000:1000、权限 0640。然后执行：

```bash
docker compose -f desktop.compose.yml -p dsh-desktop-pet up -d
```

默认连接 `dsh-deepseek-harness-1` 的 `:99` X11 桌面，原版文件只读挂载。更换 DSH 容器时设置 `DSH_CONTAINER`，重新创建 DSH 容器后也需重新创建桌宠。桌面需要启用合成器才能显示原版透明窗口。

桌宠上限 2 核 / 2048 MiB，临时文件系统 512 MiB，目标 60 FPS，`desktop-data/status.json` 提供原版动作、插值状态、软件后端、绘制次数和窗口位置。健康检查要求素材和运动场都就绪。默认保留原版闲置行为和互动面板；可以用原版快捷键 `Ctrl+Alt+P` 切换鼠标穿透。

## 接入 DSH 与预览

将 `provider.mjs`、`events.mjs`、`actions.json` 放入持久化集成目录，复用当前 DSH 的 `@deepseek-ai/dsh-tools`。在 DSH 数据目录中准备权限 0600 的 `avatar/config.json` 和 token：

```json
{
  "url": "http://10.0.0.20:19380/",
  "tokenFile": "/home/node/.dsh/avatar/token"
}
```

备份现有配置后，合并 `web.cordis.patch.yml`，再重启 DSH。`avatar_set_action` 可调用全部 38 个原生动作；兼容 `thinking`、`surprised`、`walk-left`、`walk-right` 别名。持续时间为 0.25–30 秒。有限动作仍按原版时序播放，不因指定了较长时间而被拉伸。

会话 running、模型等待和 reasoning 事件触发原版 `think`；工具执行期间继续思考，正文输出转为待机姿态并停止自主走动；结束、取消和失联回到原版闲置行为。默认第一个活跃根会话占用角色，其他根会话和子会话不会抢占。15 秒心跳维持 35 秒租约。

当前 DSH 网站的 `/avatar/` 沿用登录和来源检查，浏览器不接触角色控制密钥。预览直接使用原版 `motion/flow/app` 和全部所需素材，首次加载约 160 MiB；之后原版资源可在浏览器私有缓存中复用。服务只开放来源锁定清单中的资源，不提供任意文件路径。

## 验证与视频

所有构建、测试、素材处理和编码在服务器执行：

```bash
npm run check
DSH_ENTRYPOINT=/path/to/dsh/lib/bin.js npm test
python3 scripts/audit-release.py
DSH_AVATAR_ISOLATED_TEST=1 node integrations/png-avatar/acceptance.mjs
# 原版测试使用原版依赖路径。
NODE_PATH=/opt/avatar-electron/node_modules node --test /original/tests/*.test.cjs
```

`ui-acceptance.mjs` 验证原版播放器与运动场；只有显式设置 `DSH_AVATAR_LIVE_MODEL_TEST=1` 才发送一条真实模型验收请求。临时凭据文件在结束后删除。

`original/render-original.cjs` 在隔离 Electron 的 `AVATAR_RENDER_MODE=1` 下，控制时钟逐帧执行原版主程序与原版 `draw`，输出 60 FPS 视频。没有用重复帧假装提高动画帧率；没有修改帧序、持续时间、原版运动场或物理算法。此模式的专用 IPC 和调试端口只用于隔离验收，不向公网开放。

双机直播负载的录像配方仍为接收端先执行 `AVATAR_CAPTURE_SECONDS=30 docker compose --profile capture -p dsh-avatar run --rm encoder`，再在桌面容器内运行 `capture-desktop.sh`。采集真实桌面已包含原版角色，编码端不叠加另一套播放器。此配方默认 1080p30，是传输验收配置；原版桌面调度与离线动作视频为 60 FPS。没有配置 TTS、桌面声音或 B 站/抖音推流。

## 停用、回滚和来源

停止桌宠：`docker compose -f desktop.compose.yml -p dsh-desktop-pet down`；停止状态服务：`docker compose -p dsh-avatar down`。撤销 DSH 接入可移除新增 profile 行或恢复已核对的备份，再重启 DSH。保留会话与浏览器数据。

从旧版升级前，备份旧 compose、代码及镜像标签；不要在验收完成前删除旧素材目录。旧图片播放器已从源码配方移除，不作为新版本的静默降级路径。

原作者：YunYueSama；原项目：[codex-deepseek-pet](https://github.com/YunYueSama/codex-deepseek-pet)。完整许可和素材权利说明随导入保留。作者对其有权授权的新增贡献采用自定义署名许可；该许可不额外授予底层社区参考等第三方权利。本项目适配代码沿用 MIT 许可。
