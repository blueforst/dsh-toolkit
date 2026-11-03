# 来源与授权说明

本仓库自编部分包括 DSH 客户端扩展、资源采样与代理、Pi 费用投影、Camoufox 接入桥及安装与检查脚本，按 MIT 授权。

以下第三方项目通过公开依赖、镜像或下载地址使用，二进制和第三方核心源码不随本仓库发布；各自授权仍适用：

- [DeepSeek Harness Docker](https://github.com/runzhliu/deepseek-harness-docker)：基础镜像与 `@runzhliu/dsh-browser-desktop`；浏览器桌面入口属于上游插件，本仓库提供 Camoufox 接入。
- DeepSeek Harness：原生 Cordis、Web UI、会话投影、Pi 适配器及 Browser Use 运行时；本仓库只调用安装版本的扩展 API。
- [Pi](https://github.com/earendil-works/pi)：模型目录与费用计算，由 DSH 安装的运行时提供。当前环境包名为 `@earendil-works/pi-ai`。
- [Camoufox](https://github.com/daijro/camoufox)、Playwright、Playwright MCP、MCP SDK：浏览器运行时及自动化桥接。
- [Cua Driver](https://github.com/trycua/cua)、DSH 官方 Computer Use MCP provider：Linux 桌面控制。构建时下载固定发布物并验证摘要，不把第三方二进制或 provider 源码提交到仓库。
- Xfce、Thunar、Mousepad、xfce4-terminal 及中文字体：由 Debian 软件源安装，保留其各自授权。完整桌面镜像对上游浏览器桌面插件的客户端文字和图标作小范围调整，保留其许可证和模块身份。
- [YunYueSama/codex-deepseek-pet](https://github.com/YunYueSama/codex-deepseek-pet)：纯 2D 角色素材来源。可选导入器固定提交并保留完整原版运行文件、原图与运动场；第三方源码和素材不随本仓库分发。作者对其有权授权的贡献采用自定义署名许可，底层社区参考和其他第三方权利仍按原项目 `ASSET_LICENSE.md` 处理。

OpenCode Go 模型预设和额度适配属于本仓库的配置与代码，不包含该服务的账号或使用额度。
