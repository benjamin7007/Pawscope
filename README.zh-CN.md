# Pawscope 🐾

[English](./README.md) · [简体中文](./README.zh-CN.md)

[![CI](https://github.com/benjamin7007/Pawscope/actions/workflows/ci.yml/badge.svg)](https://github.com/benjamin7007/Pawscope/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Rust](https://img.shields.io/badge/rust-1.87+-orange?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![Status](https://img.shields.io/badge/status-active-success.svg)](https://github.com/benjamin7007/Pawscope)

> **本地 Web 仪表盘，用来观察 CLI Agent 会话的运行状态。**
> 不用再为开了 5 个终端窗口、不知道每个 Agent 在做什么而抓狂。

![Pawscope 概览](./docs/screenshot.png)

<table>
<tr>
<td width="50%"><img src="./docs/screenshot-skills.png" alt="技能页：分类环形图 + 分组列表"/></td>
<td width="50%"><img src="./docs/screenshot-session.png" alt="会话详情：轮次/消息统计 + 工具直方图"/></td>
</tr>
<tr>
<td align="center"><sub><b>技能</b> · 267 个本地技能，按 5 类分组并配使用环形图</sub></td>
<td align="center"><sub><b>会话详情</b> · 轮次、收发消息数、工具排名直方图</sub></td>
</tr>
</table>

```
┌─ Pawscope ──────────────────────────────────────────────────┐
│  ● 4dac1bf8   Building feature X         master             │
│  ○ 7c2afd91   Refactoring auth           feat/auth          │
│  ──────────────────────────────────────────────────────────  │
│   📁 ~/code/repo    🌿 master    🤖 claude-opus-4.7     ●   │
│   Turns: 12     ↑ 14 / ↓ 13                                 │
│   Tools used:   bash ×8   view ×11   edit ×3                │
│   Skills:       brainstorming  writing-plans                │
└──────────────────────────────────────────────────────────────┘
```

## 为什么需要它

当你同时开着多个 `copilot`、`claude`、`codex` 会话散落在不同终端窗口时，没办法一眼看到：
每个会话加载了哪些技能、跑过哪些工具、对话进行到第几轮、哪些会话还活着。
Pawscope 直接读取 CLI 自己已经写到磁盘上的状态（如 `~/.copilot/session-state/`），
在一个面板里实时刷新呈现。

## 安装

### 预编译二进制（推荐）

到 [Releases](https://github.com/benjamin7007/Pawscope/releases/latest) 下载对应平台的最新版本：

| 平台 | 资源包 |
|---|---|
| macOS（Apple Silicon） | `pawscope-aarch64-apple-darwin.tar.gz` |
| macOS（Intel） | `pawscope-x86_64-apple-darwin.tar.gz` |
| Linux（x86_64） | `pawscope-x86_64-unknown-linux-gnu.tar.gz` |
| Linux（aarch64） | `pawscope-aarch64-unknown-linux-gnu.tar.gz` |
| Windows（x86_64） | `pawscope-x86_64-pc-windows-msvc.zip` |

```bash
# macOS / Linux 示例
curl -fsSL -o pawscope.tar.gz \
  https://github.com/benjamin7007/Pawscope/releases/latest/download/pawscope-aarch64-apple-darwin.tar.gz
tar -xzf pawscope.tar.gz
./pawscope-aarch64-apple-darwin/pawscope serve
```

每个压缩包都附带同名 `.sha256` 校验文件。

### 从源码构建

```bash
git clone https://github.com/benjamin7007/Pawscope.git
cd Pawscope
cargo install --path .       # 或：cargo build --release
```

## 快速开始

```bash
pawscope serve             # 自动在浏览器打开 http://127.0.0.1:7777
```

可用参数：

| 参数         | 默认值               | 说明                          |
|--------------|----------------------|-------------------------------|
| `--bind`     | `127.0.0.1:7777`     | 默认仅监听本地                |
| `--no-open`  | 关                   | 不自动打开浏览器              |

## 工作原理

```
┌───────────────────────────────┐      ┌──────────────────────┐
│ ~/.copilot/session-state/     │      │ React 19 + Tailwind4 │
│   <uuid>/                     │      │ 仪表盘                │
│     workspace.yaml   ─────┐   │      │ (二进制内嵌)          │
│     events.jsonl     ─┐   │   │      └──────────▲───────────┘
│     inuse.<PID>.lock  │   │   │                 │ WS 推送
└───────────────────────┼───┼───┘                 │ + REST 快照
                        │   │                     │
                        ▼   ▼                     │
              ┌────────────────────┐              │
              │  CopilotAdapter    │              │
              │   ─ JSONL 解析     │   防抖       │
              │   ─ PID 存活检测   ├──── 200ms ───┤
              │   ─ notify 监视    │              │
              └────────────────────┘              │
                        │                         │
                        └─────► axum 服务 ────────┘
                               (单一二进制)
```

- **Adapter trait** — `pawscope-core` 里的 `AgentAdapter` 让接入 V2（Claude Code、Codex）变成纯增量：实现 trait + 注册即可。
- **无守护进程** — `pawscope serve` 就是一个普通 CLI 进程，关掉终端就结束。
- **仅本地** — 默认绑定 `127.0.0.1`，无鉴权 token、无遥测。

## 路线图

| 版本 | 范围 |
|------|------|
| **v0.1（MVP-1）** | Copilot CLI 会话、实时更新、内嵌 UI |
| **v0.2** | Claude Code 适配器（`~/.claude/projects/`）、多适配器汇聚、概览与活动热力图 |
| **v0.3** | Codex CLI 适配器（`~/.codex/state_*.sqlite` threads 表） |
| v0.4     | 跨 CLI 的技能市场 + 一键安装 |

## 架构

Cargo workspace，三个 lib crate 加一个 `pawscope` binary：

```
crates/
  pawscope-core/      # Adapter trait、共享类型、错误定义
  pawscope-copilot/   # V1 后端：Copilot CLI session-state 读取
  pawscope-server/    # axum REST + WebSocket + 内嵌 SPA
src/main.rs             # CLI 入口
web/                    # React 19 + Vite + Tailwind 4 仪表盘
e2e/                    # Playwright 烟雾测试
```

测试规模：Rust 单元 / 集成测试 12 个 + Playwright e2e 测试 2 个。

## 协议

[MIT](./LICENSE) © 2026 Pawscope contributors
