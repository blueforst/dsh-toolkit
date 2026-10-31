# 版本记录

## 0.1.0 · 2026-11-01

- 首次发布统一的 `@forst/dsh-toolkit` 原生 DSH bundle。
- 整合资源与 Go 额度模块，基于独立版 `0.1.6`；资源 1 秒、额度 60 秒刷新。
- 整合 Pi 会话费用模块，基于独立版 `0.1.4`；费用入口最前、点击浮窗、零费用缓存写隐藏。
- 增加可配置资源采集地址、通用 Linux 采集器安装脚本及单包安装说明。
- 自定义 HTTP 接口显式复用原生 Connection 的登录、Host 和 Origin 校验。
- 附 Camoufox 固定版本运行时、MCP 接入及 OpenCode Go 配置示例。
- 加入构建、回归测试、发布内容检查和 GitHub Actions。
