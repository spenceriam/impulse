# IMPULSE

[![npm version](https://img.shields.io/npm/v/@spenceriam/impulse.svg)](https://www.npmjs.com/package/@spenceriam/impulse)
[![build](https://img.shields.io/github/actions/workflow/status/spenceriam/impulse/release.yml?label=build)](https://github.com/spenceriam/impulse/actions/workflows/release.yml)
[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.0-f9f1e1?logo=bun)](https://bun.sh)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

> Terminal-based AI coding agent powered by Z.ai's Coding Plan

A brutally minimal terminal interface for AI-assisted software development. Flicker-free 60fps rendering, integrated MCP servers, and session management - all in your terminal.

<!-- TODO: Add demo GIF -->
<!-- ![IMPULSE Demo](docs/demo.gif) -->

## Features

- **GLM-4.x Models** - Z.ai's flagship models with thinking mode
- **4 Modes** - WORK, EXPLORE, PLAN, DEBUG (Tab to cycle)
- **MCP Integration** - Vision, Web Search, Web Reader, Zread, Context7
- **Session Management** - Auto-save, load previous sessions, undo/redo via git checkpoints
- **Auto-Compact** - AI summarization at 85% context usage
- **Express Mode** - Skip permission prompts in trusted environments
- **Engage Mode** - High-autonomy execution profile with a distinct status-line indicator
- **Headless Mode** - Run prompts without TUI via `--prompt`

## Installation

```bash
npm install -g @spenceriam/impulse
```

Set your API key:

```bash
# Environment variable
export GLM_API_KEY=your_key_here

# Or config file (~/.config/impulse/config.json)
echo '{"apiKey": "your_key_here"}' > ~/.config/impulse/config.json
```

## Quick Start

```bash
# Start IMPULSE
impulse

# Start with Express mode (skip permission prompts)
impulse --express

# Continue previous session
impulse --continue

# Run a prompt without TUI (headless)
impulse --prompt "explain this codebase"
```

## CLI Options

| Flag | Description |
|------|-------------|
| `-p, --prompt <text>` | Run prompt headless (no TUI) |
| `-c, --continue` | Show session picker |
| `-s, --session <id>` | Resume specific session |
| `-m, --model <model>` | Set model (default: glm-4.7) |
| `--mode <mode>` | Set mode (WORK, EXPLORE, PLAN, DEBUG) |
| `-e, --express` | Enable Express mode |
| `-d, --dir <path>` | Set working directory |
| `--verbose` | Enable verbose logging |
| `-cl, --changelog` | Show last 10 releases |
| `-v, --version` | Show version |
| `-h, --help` | Show help |

## Modes

| Mode | Purpose |
|------|---------|
| **WORK** | Full execution with all tools |
| **EXPLORE** | Read-only understanding - patient, curious, anticipatory |
| **PLAN** | Planning/documentation mode with restricted writes (`docs/`, `PRD.md`) |
| **DEBUG** | 7-step systematic debugging |

Press `Tab` to cycle modes, `Shift+Tab` to cycle reverse. The AI will suggest mode switches at natural inflection points.

## Commands

| Command | Description |
|---------|-------------|
| `/new` | New session |
| `/save` | Save session |
| `/continue` | Session picker (alias: `/load`) |
| `/undo` `/redo` | Revert/restore changes |
| `/compact` | Manually compact context |
| `/model` | Model picker |
| `/mode` | Switch mode |
| `/think` | Toggle thinking mode |
| `/express` | Toggle Express mode |
| `/engage` | Toggle Engage mode (high-autonomy execution profile) |
| `/init` | Analyze project, create AGENTS.md |
| `/stats` | Session statistics |
| `/changelog` | View release history |
| `/help` | Show help |
| `/quit` | Exit |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Tab` / `Shift+Tab` | Cycle modes |
| `Enter` | Submit |
| `Shift+Enter` | New line |
| `Up` / `Down` | Message history |
| `@` | File autocomplete |
| `Esc` (2x) | Cancel operation |
| `Ctrl+C` (2x) | Exit |
| `Ctrl+Q` | Message queue |
| `Ctrl+P` | Command palette |
| `Ctrl+M` | MCP status |

## MCP Servers

Five MCP servers integrated out of the box:

| Server | Purpose |
|--------|---------|
| **Vision** | Image/video analysis, UI screenshots |
| **Web Search** | Real-time web search |
| **Web Reader** | Fetch and parse web pages |
| **Zread** | Documentation search, GitHub repos |
| **Context7** | Library/framework documentation |

## Configuration

Config file: `~/.config/impulse/config.json`

```json
{
  "apiKey": "your_key_here",
  "defaultModel": "glm-4.7",
  "defaultMode": "WORK",
  "thinking": true,
  "express": false
}
```

## Project Instructions

IMPULSE loads project-specific instructions from these files (first found wins):

1. `.impulse/instructions.md`
2. `AGENTS.md`
3. `CLAUDE.md`, `GEMINI.md`, `QWEN.md`, `KIMI.md`, `COPILOT.md`
4. `.cursorrules`, `.windsurfrules`

## Requirements

- **Bun 1.0+** (required - OpenTUI uses bun:ffi)
- Git (for undo/redo checkpoints)
- Terminal with 256 colors

## Acknowledgements

IMPULSE wouldn't exist without these amazing projects:

- **[OpenTUI](https://github.com/pioner92/opentui)** - The terminal UI framework that makes flicker-free rendering possible
- **[Bun](https://bun.sh)** - The fast JavaScript runtime that powers everything
- **[OpenCode](https://opencode.ai)** - The inspiration for this project and the harness used to build it
- **[Z.ai](https://z.ai)** - For the GLM models and Coding Plan API

## License

[GNU AGPL-3.0](LICENSE)

**Important Notice:** This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).

**What this means:**

- You are free to use, study, modify, and distribute this software
- Any modifications you make must also be released under AGPL-3.0
- **If you run a modified version of this software as a network service (SaaS, web app, API, etc.), you must make your complete source code available to all users of that service**
- You must provide access to the Corresponding Source under the terms of this License

**Source Code Sharing Requirement:**

Anyone who uses any part of this codebase to build a service or application that users interact with over a network must share their complete modified source code (including all modifications) with those users, under the same AGPL-3.0 license.

For more details, see [LICENSE](LICENSE) or [https://www.gnu.org/licenses/agpl-3.0](https://www.gnu.org/licenses/agpl-3.0)

[sbp]
