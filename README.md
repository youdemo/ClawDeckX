<div align="center">

# ClawDeckX

**Complexity within, simplicity without.**<br>
**繁于内，简于形。**

[![Release](https://img.shields.io/badge/Release-0.0.1-blue?style=for-the-badge&logo=rocket)](https://github.com/ClawDeckX/ClawDeckX/releases)
[![Build](https://img.shields.io/badge/Build-Passing-success?style=for-the-badge&logo=github-actions)](https://github.com/ClawDeckX/ClawDeckX/actions)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

---

**ClawDeckX** is an open-source web visual management platform built for [OpenClaw](https://github.com/openclaw/openclaw). It is designed to lower the barrier to entry, making installation, configuration, monitoring, and optimization simpler and more efficient, while providing a more accessible onboarding experience for users worldwide, especially beginners.

**ClawDeckX** 是专为 [OpenClaw](https://github.com/openclaw/openclaw) 打造的开源 Web 可视化管理平台，专注于降低使用门槛，让安装、配置、观测与优化更加简单高效，为全球用户，尤其是新手用户，提供更友好的上手体验。

</div>

> [!CAUTION]
> **Beta Preview** — This is an early preview release. It has not undergone comprehensive testing. **Do not use in production environments.**
>
> **Beta 预览版** — 当前为初始预览版本，尚未进行深度完整的覆盖测试，**请勿用于生产环境。**

<br>

## ✨ Why ClawDeckX?

### macOS-Grade Visual Experience | macOS 级视觉体验

The interface faithfully recreates the macOS design language — refined glassmorphism, rounded cards, and smooth animation transitions. Managing AI agents feels as natural as using a native desktop app.

界面高度还原 macOS 设计语言，采用精致的毛玻璃效果、圆角卡片和细腻的动画过渡，让管理 AI 智能体像操作原生桌面应用一样流畅自然。

### Beginner-Friendly Setup | 新用户极友好

Guided wizards and pre-built templates let you complete OpenClaw's initial configuration and model setup without memorizing a single command.

图形化引导和预设模板，让你无需记忆复杂命令，即可快速完成 OpenClaw 的初始配置与模型接入。

### Deep Configuration | 深度配置能力

Fine-tune every OpenClaw parameter — model switching, memory management, plugin loading, channel routing — all through a beautiful visual editor.

支持对 OpenClaw 底层参数进行精细调控，包括模型切换、记忆管理、插件加载、频道路由等，满足高级用户的定制化需求。

### Real-Time Observability | 全景观测系统

Built-in monitoring dashboard with live execution status, resource consumption, and task history — full visibility into every agent's behavior.

内置实时监控仪表盘，直观展示 AI 的执行状态、资源消耗和任务历史，让你对智能体的运行了如指掌。

### Cross-Platform | 全平台支持

Single binary, zero dependencies. Runs natively on Windows, macOS (Intel & Apple Silicon), and Linux (amd64 & arm64). Download and run — that's it.

单文件零依赖，原生支持 Windows、macOS（Intel 与 Apple Silicon）和 Linux（amd64 与 arm64）。下载即用，开箱即跑。

### Responsive & Mobile-Ready | 屏幕自适应与移动端适配

Fully responsive layout that adapts seamlessly from large desktop monitors to tablets and mobile phones. Manage your AI agents on the go — no compromise on functionality.

完整的响应式布局，从大屏桌面到平板和手机无缝适配。随时随地管理你的 AI 智能体，功能体验零妥协。

### Multilingual Support | 多语言支持

Full i18n architecture with built-in English and Chinese. Adding a new language is as simple as dropping in a JSON file — no code changes required.

完整的国际化架构，内置中英双语支持。新增语言只需添加一个 JSON 文件，无需修改任何代码。

### Local & Remote Gateway | 本地与远程网关

Seamlessly manage both local and remote OpenClaw gateways. Switch between gateway profiles with one click — perfect for multi-environment setups like dev, staging, and production.

同时支持本地网关与远程网关管理。一键切换网关配置档案，轻松应对开发、测试、生产等多环境部署场景。

<br>

## 📸 Screenshots | 界面预览

<div align="center">
  <img src="assets/screenshots/dashboard.png" width="800" alt="Dashboard Overview" />
  <p><sub>Dashboard Overview | 仪表盘总览</sub></p>
</div>

<br>

<div align="center">
  <img src="assets/screenshots/scenarios.png" width="390" alt="Scenario Templates" />
  &nbsp;
  <img src="assets/screenshots/multi-agent.png" width="390" alt="Multi-Agent Workflow" />
  <p><sub>Scenario Templates &amp; Multi-Agent Workflow | 场景模板列表 &amp; 多智能体工作流</sub></p>
</div>

<br>

<div align="center">
  <img src="assets/screenshots/config.png" width="390" alt="Configuration Center" />
  &nbsp;
  <img src="assets/screenshots/skills.png" width="390" alt="Skills Center" />
  <p><sub>Configuration Center &amp; Skills Center | 配置中心 &amp; 技能中心</sub></p>
</div>

## 🚀 Quick Start

### One-Click Install | 一键安装

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/ClawDeckX/ClawDeckX/main/install.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/ClawDeckX/ClawDeckX/main/install.ps1 | iex
```

### Manual Download | 手动下载

Download the binary from [Releases](https://github.com/ClawDeckX/ClawDeckX/releases). No dependencies. Just run.

从 [Releases](https://github.com/ClawDeckX/ClawDeckX/releases) 下载二进制文件，零依赖，直接运行。

```bash
# Run with default settings / 使用默认配置启动 (localhost:18791)
./ClawDeckX

# Specify port and bind address / 指定端口和绑定地址
./ClawDeckX --port 18791 --bind 0.0.0.0

# Create initial admin user on first run / 首次运行时创建管理员账户
./ClawDeckX --user admin --pass your_password

# All options combined / 组合使用所有参数
./ClawDeckX --bind 0.0.0.0 --port 18791 --user admin --pass your_password
```

| Flag | Short | Description | 说明 |
| :--- | :---: | :--- | :--- |
| `--port` | `-p` | Server port (default: `18791`) | 服务端口（默认 `18791`） |
| `--bind` | `-b` | Bind address (default: `127.0.0.1`) | 绑定地址（默认 `127.0.0.1`） |
| `--user` | `-u` | Initial admin username (first run only) | 初始管理员用户名（仅首次） |
| `--pass` | | Initial admin password (min 6 chars) | 初始管理员密码（至少 6 位） |
| `--debug` | | Enable debug logging | 启用调试日志 |

<br>

### Docker Install | Docker 一键安装

```bash
# Download and start / 下载并启动
curl -fsSL https://raw.githubusercontent.com/ClawDeckX/ClawDeckX/main/docker-compose.yml -o docker-compose.yml
docker compose up -d
```

Open your browser at `http://localhost:18791`. The first run will auto-generate an admin account — credentials will be shown in the container logs.

浏览器打开 `http://localhost:18791`，首次启动会自动生成管理员账户，凭据将显示在容器日志中。

```bash
# View credentials / 查看初始凭据
docker logs clawdeckx
```

> **Note:** By default, the container connects to an OpenClaw Gateway on the host machine at port `18789`. Edit `docker-compose.yml` to change `OCD_OPENCLAW_GATEWAY_HOST` and `OCD_OPENCLAW_GATEWAY_PORT` as needed.
>
> **说明：** 默认连接宿主机 `18789` 端口的 OpenClaw Gateway，可在 `docker-compose.yml` 中修改 `OCD_OPENCLAW_GATEWAY_HOST` 和 `OCD_OPENCLAW_GATEWAY_PORT`。

<br>

## ✨ Features

| | Feature | Description | 说明 |
| :---: | :--- | :--- | :--- |
| 💎 | **Pixel-Perfect UI** | Native macOS feel with glassmorphism, smooth animations, dark/light themes | macOS 级视觉体验，毛玻璃效果、流畅动画、明暗主题 |
| 🎛️ | **Gateway Control** | Start, stop, restart your Gateway instantly with real-time health monitoring | 一键启停网关，实时健康监控 |
| 🖼 | **Visual Config Editor** | Edit configurations and agent profiles without touching JSON/YAML | 可视化配置编辑器，告别手写 JSON/YAML |
| 🧙 | **Setup Wizard** | Step-by-step guided setup for first-time users | 新手引导向导，逐步完成配置 |
| 🧩 | **Template Center** | Deploy new agent personas in seconds with built-in templates | 模板中心，秒级部署新代理人设 |
| 📊 | **Live Dashboard** | Real-time metrics, session tracking, and activity monitoring | 实时仪表盘，会话追踪与活动监控 |
| 🛡️ | **Security Built-in** | JWT auth, HttpOnly cookies, and alert system from day one | 内置安全体系：JWT 认证、HttpOnly Cookie、告警系统 |
| 🌍 | **i18n Ready** | Full English and Chinese support, easily extensible | 完整国际化，内置中英双语，轻松扩展 |
| 📱 | **Responsive Design** | Works seamlessly on desktop and mobile | 响应式设计，桌面与移动端无缝适配 |

<br>

## 🛠️ Tech Stack | 技术栈

| Layer | Technology | 说明 |
| :--- | :--- | :--- |
| **Backend** | Go (Golang) | 单文件编译，零外部依赖 |
| **Frontend** | React + TailwindCSS | 响应式、主题感知 UI |
| **Database** | SQLite / PostgreSQL | 默认 SQLite，可选 PostgreSQL |
| **Real-time** | WebSocket + SSE | 实时双向通信 |
| **Deployment** | Single binary, cross-platform | 单文件跨平台（Windows / macOS / Linux） |
| **Container** | Docker / Docker Compose | 一键 Docker 部署，支持 amd64 & arm64 |

<br>

## 🤝 Contributing | 参与贡献

We welcome contributions! Whether you're fixing bugs, adding features, or improving documentation, your help is appreciated.

欢迎参与贡献！无论是修复 Bug、添加功能还是改进文档，我们都非常感谢。

<br>

## 💬 A Note from the Author | 作者寄语

This is my first open-source project, and I hope it will continue to improve with the help of the community. If you run into any issues or have ideas for improvement, feel free to open an [Issue](https://github.com/ClawDeckX/ClawDeckX/issues) or submit a [Pull Request](https://github.com/ClawDeckX/ClawDeckX/pulls). Thank you for your support. Every piece of feedback helps this project grow.

这是我的第一个开源项目，也希望它能在大家的参与下变得越来越好。如果你发现问题，或有任何改进想法，欢迎提交 [Issue](https://github.com/ClawDeckX/ClawDeckX/issues) 或 [Pull Request](https://github.com/ClawDeckX/ClawDeckX/pulls)。感谢你的关注和支持，每一次反馈，都是这个项目成长的一部分。

> *An AI predicted this project would go viral. But as we all know, AIs do hallucinate sometimes 😅*
>
> *某 AI 曾预言本项目会大火——不过众所周知，AI 这东西，是会产生幻觉的😅。*

<br>

## 📄 License | 开源协议

This project is licensed under the [MIT License](LICENSE) — free to use, modify, and distribute for both personal and commercial purposes.

本项目基于 [MIT 协议](LICENSE) 开源 — 可自由使用、修改和分发，适用于个人及商业用途。

<br>

<div align="center">
  <sub>Designed with ❤️ by ClawDeckX</sub>
</div>
