<div align="center">

<img src="./docs/screenshots/01-overview.png" alt="Pawscope overview dashboard"/>

# Pawscope 🐾

**A local web dashboard for inspecting your CLI agent sessions in real time.**

Stop wondering what `copilot`, `claude`, and `codex` are actually doing across five terminal windows.
One panel. Read-only. No daemon. Local by default.

[English](./README.md) · [简体中文](./README.zh-CN.md)

[![CI](https://github.com/benjamin7007/Pawscope/actions/workflows/ci.yml/badge.svg)](https://github.com/benjamin7007/Pawscope/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/benjamin7007/Pawscope?logo=github)](https://github.com/benjamin7007/Pawscope/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Rust](https://img.shields.io/badge/rust-1.87+-orange?logo=rust&logoColor=white)](https://www.rust-lang.org)

</div>

---

## What it does

Pawscope reads the state your CLI agents already write to disk
(`~/.copilot/session-state/`, `~/.claude/projects/`, `~/.codex/state_*.sqlite`, `~/.local/share/opencode/`)
and renders it as a single, live-updating dashboard:

- **See what's running.** Every active session, every conversation, in one place — across **6 agents**.
- **See what it cost.** Per-turn token usage, model-aware USD estimates, daily budget tracking.
- **See what it touched.** Tools called, skills loaded, files mentioned, prompts asked.
- **Catch problems early.** Hot files, dangerous tools, dormant sessions, peak hours, cost outliers.
- **Manage your skills.** Browse 328+ community skills, install per-project or globally, with categories.
- **Organize sessions.** Hide, delete (trash), rename, star, tag, and compare sessions.

No telemetry. No cloud. No login. The binary boots, scans your home directory, opens your browser. That's it.

---

## Highlights

<table>
<tr>
<td width="33%" valign="top">

### 🔍 Conversation flow
Cross-agent visualization of every interaction — user prompt → assistant turns → tool calls → sub-agent threads — color-coded and timestamped. Works for Claude, Copilot, and Codex sessions equally.

</td>
<td width="33%" valign="top">

### 💰 Token & cost tracking
Per-turn token chips (↓in / ↑out / cache / $) on every assistant message, plus a session-level rollup with by-model breakdown. Pricing table covers Opus 3.x–4.7, Sonnet 3.5–4.6, Haiku, GPT-5, GPT-5-Codex, GPT-4.1, GPT-4o.

</td>
<td width="33%" valign="top">

### 🛠 Skills discovery
Auto-detects skill libraries across `~/.claude/skills/`, `~/.copilot/skills/`, project-local `.github/skills/`, and `.agents/skills/`. Categorized donut, usage counts, project-skill content viewer, taxonomy with 240+ entries.

</td>
</tr>
<tr>
<td width="33%" valign="top">

### 🔀 Prompt clustering
Toggle-on grouping of similar prompts using token-overlap (Jaccard ≥ 0.45). See repeated requests at a glance and surface patterns across sessions.

</td>
<td width="33%" valign="top">

### ⚖️ Side-by-side compare
Shift+click two sessions in the sidebar → instant diff: stats, top tools, top skills, tool overlap (shared / only-left / only-right), and prompt-overlap analysis.

</td>
<td width="33%" valign="top">

### 📥 Daily / weekly digests
One click exports a Markdown digest for the last 24h or 7d — activity, cost, hot files, dangerous tool calls, top tools/skills, peak hours.

</td>
</tr>
<tr>
<td width="33%" valign="top">

### 🏪 Skill Store
Browse **328+ community skills** from [awesome-copilot](https://github.com/github/awesome-copilot). **13 categories**, install per-project (`.github/skills/`) or globally. Search, filter, preview SKILL.md inline.

</td>
<td width="33%" valign="top">

### 🤖 6-Agent support
Copilot ✦ · Claude ◈ · Codex ⬡ · OpenCode ⊙ · Gemini ◆ · Aider ▣ — unified view with color-coded icons, agent filter, and distribution donut chart.

</td>
<td width="33%" valign="top">

### 🗂 Session management
Hide, delete (move to trash), rename, star, tag sessions. Compare 2–5 sessions side-by-side with token bar chart, tool overlap, and prompt diff.

</td>
</tr>
</table>

---

## Tour

<table>
<tr>
<td width="50%"><a href="./docs/screenshots/02-session.png"><img src="./docs/screenshots/02-session.png" alt="Session detail"/></a></td>
<td width="50%"><a href="./docs/screenshots/03-flow.png"><img src="./docs/screenshots/03-flow.png" alt="Conversation flow"/></a></td>
</tr>
<tr>
<td align="center"><sub><b>Session detail</b> — turns, messages, tool histogram, token budget</sub></td>
<td align="center"><sub><b>Conversation flow</b> — full prompt / response / tool-call timeline</sub></td>
</tr>
<tr>
<td width="50%"><a href="./docs/screenshots/04-skills.png"><img src="./docs/screenshots/04-skills.png" alt="Skills page"/></a></td>
<td width="50%"><a href="./docs/screenshots/05-prompts.png"><img src="./docs/screenshots/05-prompts.png" alt="Prompts search"/></a></td>
</tr>
<tr>
<td align="center"><sub><b>Skills</b> — local skills grouped by category, with a usage donut</sub></td>
<td align="center"><sub><b>Prompts</b> — full-text search across all sessions, optional clustering</sub></td>
</tr>
<tr>
<td width="50%"><a href="./docs/screenshots/06-config.png"><img src="./docs/screenshots/06-config.png" alt="Config page"/></a></td>
<td width="50%"><a href="./docs/screenshots/07-store.png"><img src="./docs/screenshots/07-store.png" alt="Skill Store"/></a></td>
</tr>
<tr>
<td align="center"><sub><b>Config</b> — persona, agents, installed skills, 30-day token trend</sub></td>
<td align="center"><sub><b>Skill Store</b> — 328+ community skills, 13 categories, project/global install</sub></td>
</tr>
</table>

> Screenshots taken from a live Pawscope instance. No synthetic data — what you see is what you get.

---

## Install

### One-line install (macOS · Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/benjamin7007/Pawscope/master/install.sh | bash
```

Detects your platform, downloads the latest release, verifies SHA-256, drops the binary into `~/.local/bin` (or `/usr/local/bin` if writable). Pin a version with `PAWSCOPE_VERSION=v1.0.0`, change the prefix with `PAWSCOPE_PREFIX=/opt/bin`.

To remove it later:

```bash
curl -fsSL https://raw.githubusercontent.com/benjamin7007/Pawscope/master/uninstall.sh | bash
```

### Pre-built binaries

Grab the latest from [Releases](https://github.com/benjamin7007/Pawscope/releases/latest):

| Platform | Asset |
|---|---|
| macOS · Apple Silicon | `pawscope-aarch64-apple-darwin.tar.gz` |
| macOS · Intel | `pawscope-x86_64-apple-darwin.tar.gz` |
| Linux · x86_64 | `pawscope-x86_64-unknown-linux-gnu.tar.gz` |
| Linux · aarch64 | `pawscope-aarch64-unknown-linux-gnu.tar.gz` |
| Windows · x86_64 | `pawscope-x86_64-pc-windows-msvc.zip` |

```bash
# macOS / Linux example
curl -fsSL -o pawscope.tar.gz \
  https://github.com/benjamin7007/Pawscope/releases/latest/download/pawscope-aarch64-apple-darwin.tar.gz
tar -xzf pawscope.tar.gz
./pawscope-aarch64-apple-darwin/pawscope serve
```

Each archive ships with a matching `.sha256`.

### From source

```bash
git clone https://github.com/benjamin7007/Pawscope.git
cd Pawscope
cargo install --path .          # or: cargo build --release
```

Requires Rust 1.87+. The web bundle is built and embedded automatically.

---

## Quick start

```bash
pawscope serve                  # opens http://127.0.0.1:7777 in your browser
```

| Flag         | Default              | Notes                            |
|--------------|----------------------|----------------------------------|
| `--bind`     | `127.0.0.1:7777`     | local-only by default            |
| `--no-open`  | off                  | skip auto-launching the browser  |

> **Tip:** Cmd/Ctrl+K opens the command palette. Shift+click two sessions in the sidebar to compare them. The 📥 buttons in the Overview header export a Markdown digest.

---

## Architecture

![Pawscope architecture](./docs/architecture.png)

- **Adapter trait** — `AgentAdapter` in `pawscope-core` makes new CLIs pure additions: implement the trait, register the adapter. Six built-in adapters: Copilot, Claude, Codex, OpenCode, Gemini, Aider.
- **Single binary** — `pawscope-server` (axum) embeds the React 19 SPA via `rust-embed` at build time; no separate static-file step at runtime.
- **No daemon** — `pawscope serve` is a regular CLI process; close the terminal and it's gone.
- **Local only** — binds `127.0.0.1` by default. No auth, no telemetry, no outbound calls (except optional Skill Store fetch from GitHub).

---

## Roadmap

| Version | Focus | Status |
|---|---|---|
| v0.1 | Copilot CLI sessions · real-time updates · embedded UI | ✅ |
| v0.2 | Claude Code adapter · multi-adapter fan-out · activity heatmap | ✅ |
| v0.3 | Codex CLI adapter (`~/.codex/state_*.sqlite`) | ✅ |
| v0.4 | Skills coverage · prompts search · tool-call drilldown · star+tag · UI polish | ✅ |
| v0.5 | Cost estimation · model pricing · cost analytics · 6 power features | ✅ |
| v0.6 | Conversation flow visualization · cross-agent unified timeline | ✅ |
| v0.7 | Skills taxonomy (244 entries) · project-local skill discovery | ✅ |
| v0.8 | Per-turn token tracking · session rollup · model-aware cost | ✅ |
| v0.9 | Digest export · prompt clustering · side-by-side session compare | ✅ |
| **v1.0** | **API freeze · documentation · public release** | ✅ |
| v1.1 | Config page · 30-day token trend · multi-session compare (2–5) | ✅ |
| v1.2 | Skill Store (328+ skills, 13 categories) · agent type icons | ✅ |
| **v1.3** | **Session management (hide/delete/rename) · 6-agent support · project-level skill install** | ✅ |

---

## Project layout

```text
crates/
  pawscope-core/      # AgentAdapter trait, shared types, pricing table
  pawscope-copilot/   # Copilot CLI session-state reader
  pawscope-claude/    # Claude Code session reader
  pawscope-codex/     # Codex CLI sqlite + rollout reader
  pawscope-opencode/  # OpenCode sqlite reader
  pawscope-gemini/    # Gemini CLI adapter (stub)
  pawscope-aider/     # Aider adapter (stub)
  pawscope-server/    # axum REST + WebSocket + Skill Store + embedded SPA
src/main.rs           # CLI entrypoint
web/                  # React 19 + Vite + Tailwind 4 dashboard
e2e/                  # Playwright smoke tests + screenshot capture
tests/                # Cross-adapter integration tests
```

---

## Privacy

Everything runs on your machine. Pawscope reads from `~/.copilot/`, `~/.claude/`, `~/.codex/`, `~/.local/share/opencode/` and similar local paths only. The Skill Store optionally fetches from `github.com/github/awesome-copilot` — no other outbound calls. There is no analytics endpoint, no update check, and the server binds to loopback by default. Bind it elsewhere at your own risk.

---

## License

[MIT](./LICENSE) © 2026 Pawscope contributors
