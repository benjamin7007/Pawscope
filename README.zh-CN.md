<div align="center">

<img src="./docs/screenshots/01-overview.png" alt="Pawscope 总览面板"/>

# Pawscope 🐾

**本地命令行 Agent 会话的实时观察面板。**

不用再在五个终端窗口之间切来切去猜 `copilot` / `claude` / `codex` 在干什么。
一个面板，只读，无后台守护进程，默认仅本机访问。

[English](./README.md) · [简体中文](./README.zh-CN.md)

[![CI](https://github.com/benjamin7007/Pawscope/actions/workflows/ci.yml/badge.svg)](https://github.com/benjamin7007/Pawscope/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/benjamin7007/Pawscope?logo=github)](https://github.com/benjamin7007/Pawscope/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Rust](https://img.shields.io/badge/rust-1.87+-orange?logo=rust&logoColor=white)](https://www.rust-lang.org)

</div>

---

## 它做什么

Pawscope 直接读取本地 CLI Agent 已经写到磁盘上的状态
（`~/.copilot/session-state/`、`~/.claude/projects/`、`~/.codex/state_*.sqlite`、`~/.local/share/opencode/`），
渲染成一个实时刷新的统一面板：

- **看进度** —— 所有正在跑的会话、所有对话，**6 个 Agent** 集中在一个页面。
- **看花费** —— 每轮 token 用量、按模型估算的 USD、每日预算追踪。
- **看动作** —— 调过哪些 Tool、加载了哪些 Skill、提到了哪些文件、问了哪些 Prompt。
- **看异常** —— 高频文件、危险工具、僵尸会话、活跃时段、成本离群点。
- **管 Skill** —— 浏览 328+ 社区技能，按项目或全局安装，13 个自动分类。
- **跨设备同步** —— 登录 GitHub，收藏技能一键推送到仓库，换台电脑拉取即恢复。分类卡片网格 + ☁️ 同步徽章。
- **管会话** —— 隐藏、删除（回收站）、重命名、收藏、标签、多会话对比。

无遥测、无云端、无登录。启动二进制 → 扫描家目录 → 打开浏览器，就这些。

---

## 亮点功能

<table>
<tr>
<td width="33%" valign="top">

### 🔍 对话流可视化
跨 Agent 的统一时间线 —— 用户提问 → Assistant 回答 → 工具调用 → 子 Agent 线程，按颜色和时间戳分层展示。Claude / Copilot / Codex 三种 CLI 都支持。

</td>
<td width="33%" valign="top">

### 💰 Token 与成本追踪
每条 Assistant 消息上方都带 token chip（↓in / ↑out / cache / $），会话顶部还有按模型分组的总成本。覆盖 Opus 3.x–4.7、Sonnet 3.5–4.6、Haiku、GPT-5、GPT-5-Codex、GPT-4.1、GPT-4o。

</td>
<td width="33%" valign="top">

### 🛠 Skills 探测
自动发现 `~/.claude/skills/`、`~/.copilot/skills/` 以及项目内 `.github/skills/`、`.agents/skills/`。带分类环形图、使用次数、项目内容预览，附 240+ 条目分类法。

</td>
</tr>
<tr>
<td width="33%" valign="top">

### 🔀 Prompt 聚类
开关式相似 Prompt 聚类（基于 token 重叠 Jaccard ≥ 0.45）。一眼看出重复请求、跨会话浮现共同模式。

</td>
<td width="33%" valign="top">

### ⚖️ 会话对比
在侧边栏 Shift+点击两个会话 → 即刻 diff：基础统计、Top Tool、Top Skill、工具重叠（共享 / 仅左 / 仅右）、Prompt 重叠分析。

</td>
<td width="33%" valign="top">

### 📥 日报 / 周报导出
一键导出最近 24 小时或 7 天的 Markdown 摘要 —— 活跃度、花费、高频文件、危险工具调用、Top Tools/Skills、活跃时段。

</td>
</tr>
<tr>
<td width="33%" valign="top">

### 🏪 技能商店 & 同步
浏览 **328+ 社区技能**，来自 [awesome-copilot](https://github.com/github/awesome-copilot)。**13 个自动分类**，一键安装到项目目录或全局。登录 GitHub 后收藏推送到远程仓库，换台电脑拉取同步 —— 分类卡片网格 + ☁️ 已同步徽章。

</td>
<td width="33%" valign="top">

### 🤖 6 Agent 支持
Copilot ✦ · Claude ◈ · Codex ⬡ · OpenCode ⊙ · Gemini ◆ · Aider ▣ —— 统一视图，彩色图标、Agent 过滤器、分布甜甜圈图。

</td>
<td width="33%" valign="top">

### 🗂 会话管理
隐藏、删除（移到回收站）、重命名、收藏、标签。支持 2–5 个会话并排对比，Token 柱状图、工具重叠、Prompt 差异分析。

</td>
</tr>
</table>

---

## 截图巡览

<table>
<tr>
<td width="50%"><a href="./docs/screenshots/02-session.png"><img src="./docs/screenshots/02-session.png" alt="Session detail"/></a></td>
<td width="50%"><a href="./docs/screenshots/03-flow.png"><img src="./docs/screenshots/03-flow.png" alt="Conversation flow"/></a></td>
</tr>
<tr>
<td align="center"><sub><b>会话详情</b> —— 轮次、消息、工具直方图、指令文件与系统提示</sub></td>
<td align="center"><sub><b>对话流</b> —— 完整的提问 / 回答 / 工具调用时间线</sub></td>
</tr>
<tr>
<td width="50%"><a href="./docs/screenshots/04-skills.png"><img src="./docs/screenshots/04-skills.png" alt="Skills"/></a></td>
<td width="50%"><a href="./docs/screenshots/05-prompts.png"><img src="./docs/screenshots/05-prompts.png" alt="Prompts"/></a></td>
</tr>
<tr>
<td align="center"><sub><b>Skills 页</b> —— 本地 Skill 按分类聚合 + 使用频率环形图</sub></td>
<td align="center"><sub><b>Prompts 页</b> —— 跨会话全文搜索，可选聚类视图</sub></td>
</tr>
<tr>
<td width="50%"><a href="./docs/screenshots/06-config.png"><img src="./docs/screenshots/06-config.png" alt="Config"/></a></td>
<td width="50%"><a href="./docs/screenshots/07-store.png"><img src="./docs/screenshots/07-store.png" alt="Store"/></a></td>
</tr>
<tr>
<td align="center"><sub><b>配置页</b> —— 6 Agent 卡片、设置项、全局指令、会话统计</sub></td>
<td align="center"><sub><b>技能商店</b> —— 328+ 社区技能，13 分类，项目/全局安装</sub></td>
</tr>
<tr>
<td width="50%" colspan="2" align="center"><a href="./docs/screenshots/08-instructions.png"><img src="./docs/screenshots/08-instructions.png" alt="Instructions" width="50%"/></a></td>
</tr>
<tr>
<td align="center" colspan="2"><sub><b>指令文件</b> —— 每个会话的项目级指令文件和系统提示</sub></td>
</tr>
</table>

> 截图来自真实运行的 Pawscope 实例，所见即所得。

---

## 安装

### 一键安装（macOS · Linux）

```bash
curl -fsSL https://raw.githubusercontent.com/benjamin7007/Pawscope/master/install.sh | bash
```

自动识别平台、抓最新 release、校验 SHA-256，把二进制放到 `~/.local/bin`（或 `/usr/local/bin`，若可写）。环境变量：`PAWSCOPE_VERSION=v1.0.0` 锁版本，`PAWSCOPE_PREFIX=/opt/bin` 改安装目录。

卸载：

```bash
curl -fsSL https://raw.githubusercontent.com/benjamin7007/Pawscope/master/uninstall.sh | bash
```

### 预编译二进制

从 [Releases](https://github.com/benjamin7007/Pawscope/releases/latest) 抓最新版：

| 平台 | 资源 |
|---|---|
| macOS · Apple Silicon | `pawscope-aarch64-apple-darwin.tar.gz` |
| macOS · Intel | `pawscope-x86_64-apple-darwin.tar.gz` |
| Linux · x86_64 | `pawscope-x86_64-unknown-linux-gnu.tar.gz` |
| Linux · aarch64 | `pawscope-aarch64-unknown-linux-gnu.tar.gz` |
| Windows · x86_64 | `pawscope-x86_64-pc-windows-msvc.zip` |

```bash
# macOS / Linux 示例
curl -fsSL -o pawscope.tar.gz \
  https://github.com/benjamin7007/Pawscope/releases/latest/download/pawscope-aarch64-apple-darwin.tar.gz
tar -xzf pawscope.tar.gz
./pawscope-aarch64-apple-darwin/pawscope serve
```

每个压缩包都附带对应的 `.sha256` 校验文件。

### 从源码构建

```bash
git clone https://github.com/benjamin7007/Pawscope.git
cd Pawscope
cargo install --path .          # 或：cargo build --release
```

需要 Rust 1.87+。前端 bundle 会在 build 阶段自动构建并嵌入。

---

## 快速开始

```bash
pawscope serve                  # 自动打开 http://127.0.0.1:7777
```

| 参数         | 默认值              | 说明                              |
|--------------|---------------------|-----------------------------------|
| `--bind`     | `127.0.0.1:7777`    | 默认仅本机访问                    |
| `--no-open`  | 关闭                | 不要自动打开浏览器                |

> **小贴士：** Cmd/Ctrl+K 唤出命令面板。在侧边栏 Shift+点击两个会话即可对比。Overview 顶栏的 📥 按钮可导出 Markdown 摘要。

---

## 架构

![Pawscope 架构](./docs/architecture.png)

- **Adapter Trait** —— `pawscope-core` 中的 `AgentAdapter` 让接入新 CLI 变成纯增量工作：实现 trait → 注册 Adapter。内置六个 Adapter：Copilot、Claude、Codex、OpenCode、Gemini、Aider。
- **单一二进制** —— `pawscope-server`（axum）通过 `rust-embed` 在 build 阶段把 React 19 SPA 一并嵌入，运行时无需单独的静态文件目录。
- **无守护进程** —— `pawscope serve` 就是一个普通 CLI 进程，关掉终端即结束。
- **仅限本机** —— 默认绑定 `127.0.0.1`。无鉴权、无遥测、无外部调用（技能商店可选从 GitHub 拉取）。

---

## 路线图

| 版本 | 主题 | 状态 |
|---|---|---|
| v0.1 | Copilot CLI 会话 · 实时刷新 · 内嵌 UI | ✅ |
| v0.2 | Claude Code Adapter · 多 Adapter 聚合 · 活跃度热图 | ✅ |
| v0.3 | Codex CLI Adapter（`~/.codex/state_*.sqlite`） | ✅ |
| v0.4 | Skills 覆盖率 · Prompt 搜索 · 工具调用下钻 · 收藏+标签 · UI 打磨 | ✅ |
| v0.5 | 成本估算 · 模型价目表 · 成本分析 · 6 项 Power Features | ✅ |
| v0.6 | 对话流可视化 · 跨 Agent 统一时间线 | ✅ |
| v0.7 | Skills 分类法（244 条）· 项目内 Skill 发现 | ✅ |
| v0.8 | 每轮 Token 追踪 · 会话级汇总 · 按模型估价 | ✅ |
| v0.9 | 摘要导出 · Prompt 聚类 · 会话并排对比 | ✅ |
| **v1.0** | **API 冻结 · 文档完善 · 公开发布** | ✅ |
| v1.1 | 配置页 · 30 天 Token 趋势 · 多会话对比（2–5） | ✅ |
| v1.2 | 技能商店（328+ 技能，13 分类）· Agent 类型图标 | ✅ |
| **v1.3** | **会话管理（隐藏/删除/重命名）· 6 Agent 支持 · 项目级技能安装** | ✅ |
| **v1.4** | **会话指令与人设 · 多 Agent 配置卡片 · 系统提示显示** | ✅ |
| v1.5 | 我的收藏库（收藏、分类、排序）· 数据分析面板 | ✅ |
| v1.6 | 可折叠总览 · 会话上下文（plan、checkpoint、todo） | ✅ |
| v1.7 | GitHub 同步（登录、收藏推送/拉取）· SSH 优先克隆 | ✅ |
| v1.8 | 持久化同步仓库 · 分类推送 · 收藏存根 SKILL.md | ✅ |
| **v1.9** | **远程技能卡片网格 · 视觉分区 · 同步徽章 · 删除确认** | ✅ |

---

## 项目结构

```text
crates/
  pawscope-core/      # AgentAdapter trait、共享类型、价目表
  pawscope-copilot/   # Copilot CLI session-state 读取器
  pawscope-claude/    # Claude Code 会话读取器
  pawscope-codex/     # Codex CLI sqlite + rollout 读取器
  pawscope-opencode/  # OpenCode sqlite 读取器
  pawscope-gemini/    # Gemini CLI Adapter（stub）
  pawscope-aider/     # Aider Adapter（stub）
  pawscope-server/    # axum REST + WebSocket + 技能商店 + 内嵌 SPA
src/main.rs           # CLI 入口
web/                  # React 19 + Vite + Tailwind 4 前端
e2e/                  # Playwright 烟囱测试 + 截图脚本
tests/                # 跨 Adapter 集成测试
```

---

## 隐私

所有逻辑都跑在你本机。Pawscope 只读 `~/.copilot/`、`~/.claude/`、`~/.codex/`、`~/.local/share/opencode/` 等本地目录。技能商店可选从 `github.com/github/awesome-copilot` 拉取，除此之外没有任何外部调用。没有遥测端点、没有更新检查，server 默认绑定 loopback。如果你打算改绑外部地址，请自行评估风险。

---

## 许可

[MIT](./LICENSE) © 2026 Pawscope contributors
