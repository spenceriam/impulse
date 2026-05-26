# IMPULSE

[![npm version](https://img.shields.io/npm/v/@spenceriam/impulse.svg)](https://www.npmjs.com/package/@spenceriam/impulse)
[![build](https://img.shields.io/github/actions/workflow/status/spenceriam/impulse/release.yml?label=build)](https://github.com/spenceriam/impulse/actions/workflows/release.yml)
[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.0-f9f1e1?logo=bun)](https://bun.sh)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

> Provider-flexible terminal AI coding agent

A brutally minimal terminal interface for AI-assisted software development. Supports any OpenAI-compatible or Anthropic-compatible provider — Ollama Cloud, OpenRouter, Fireworks, Moonshot, Xiaomi Mimo, and many more. Model discovery, reasoning detection, vision model routing, and session management — all in your terminal.

## Features

- **Custom provider support** — Any OpenAI-compatible or Anthropic-compatible endpoint. Unlimited custom providers with automatic model discovery, reasoning capability probing, and persistent configuration
- **4 Modes** — WORK, EXPLORE, PLAN, DEBUG (Tab to cycle)
- **Vision model** — Optional vision-capable model for image/screenshot interpretation with automatic fallback
- **Advisor mode** — Plan/approve/execute pattern with separate advisor model and approval overlay
- **Web research** — Built-in `web_search` and `web_fetch` with bundled `agent-browser` fallback
- **Ollama provider** — Full integration with capability discovery via `/api/show`
- **Session management** — `impulse --list-sessions`, `--enrich-session-titles`; `/resume` picker with titles; empty sessions hidden
- **Full-width pickers** — `/model`, `/resume`, and provider setup use arrow-key overlays with wrapped labels
- **DEBUG workflow** — Tab DEBUG mode uses evidence-first debugging; `/debug` toggles session log file only
- **Profile** — `/user` overlay to view and edit preferences

## Installation

```bash
npm install -g @spenceriam/impulse
```

On first run, IMPULSE will guide you through interactive provider setup. You can also configure providers manually:

```bash
# Environment variables
export OLLAMA_API_KEY=your_key_here
export OPENROUTER_API_KEY=your_key_here

# Or config file (~/.impulse/config.json)
echo '{"providers":{"ollama":{"baseUrl":"https://ollama.com"}},"defaultProvider":"ollama","defaultModel":"ollama/deepseek-v4-pro"}' > ~/.impulse/config.json
```

## Quick Start

```bash
# Start IMPULSE with interactive setup
impulse

# Re-run provider configuration
impulse --setup

# Show version
impulse --version
```

## CLI Options

| Flag | Description |
|------|-------------|
| `--setup` | Interactive provider configuration |
| `--list-sessions` | Print session counts (total, resumeable, empty, titled) |
| `--enrich-session-titles` | Backfill AI titles on saved sessions |
| `--dry-run` | With `--enrich-session-titles`, preview without writing |
| `--limit N` | With `--enrich-session-titles`, cap sessions processed |
| `--project current` | With `--enrich-session-titles`, scope to cwd project only (default: all) |
| `-v, --version` | Show version |
| `-h, --help` | Show help |

## Modes

| Mode | Purpose |
|------|---------|
| **WORK** | Full execution with all tools |
| **EXPLORE** | Read-only understanding — patient, curious |
| **PLAN** | Planning and documentation |
| **DEBUG** | Systematic debugging |

Press `Tab` to cycle modes, `Shift+Tab` to cycle reasoning levels.

## Commands

| Command | Description |
|---------|-------------|
| `/model` | Choose provider, API key, and model |
| `/vision` | Toggle vision model translation (`on` / `off`) |
| `/advisor` | Configure and toggle advisor mode |
| `/mode` | Switch mode (WORK, EXPLORE, PLAN, DEBUG) |
| `/reason` | Set reasoning level (`off`, `low`, `medium`, `high`) |
| `/user` | View/update profile and preferences |
| `/new` | Start a new session |
| `/debug` | Toggle session debug log file (not Tab DEBUG mode) |
| `/resume` | Resume a saved session (picker) |
| `/clear` | Clear the chat view |
| `/help` | Show commands and keyboard shortcuts |
| `/quit` | Exit |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Tab` | Cycle modes forward |
| `Shift+Tab` | Cycle reasoning level |
| `Enter` | Submit |
| `Esc` (2x) | Abort current turn |
| `Ctrl+C` (2x) | Exit |

## Web Research

IMPULSE includes provider-neutral web tools. The model can use `web_search` to discover current sources and `web_fetch` to read exact URLs. If direct search/fetch fails, IMPULSE falls back to bundled `agent-browser` for browser-backed access.

## Configuration

Config file: `~/.impulse/config.json` (migrates from `~/.config/impulse` on first run if present)

```json
{
  "providers": {
    "ollama": { "baseUrl": "https://ollama.com" },
    "custom-openai": {
      "apiKey": "your_key_here",
      "baseUrl": "https://api.example.com/v1",
      "type": "openai-compatible"
    },
    "custom-anthropic": {
      "apiKey": "your_key_here",
      "baseUrl": "https://api.example.com",
      "type": "anthropic-compatible"
    }
  },
  "defaultProvider": "ollama",
  "defaultModel": "ollama/deepseek-v4-pro",
  "defaultMode": "AGENT",
  "reasoningLevel": "medium",
  "visionModel": "openrouter/qwen/qwen2.5-vl-72b-instruct",
  "visionProvider": "openrouter",
  "visionMode": false
}
```

## Project Instructions

IMPULSE loads project-specific instructions from these files (first found wins):

1. `.impulse/instructions.md`
2. `AGENTS.md`
3. `CLAUDE.md`, `GEMINI.md`, `QWEN.md`, `KIMI.md`, `COPILOT.md`
4. `.cursorrules`, `.windsurfrules`

## Requirements

- **Bun 1.0+**
- Git (recommended)
- Terminal with 256 colors

## Acknowledgements

IMPULSE wouldn't exist without these projects:

- **[pi-tui](https://github.com/mariozechner/pi-tui)** — The terminal UI framework powering the CLI
- **[Bun](https://bun.sh)** — The fast JavaScript runtime
- **[OpenCode](https://opencode.ai)** — The original inspiration
- **[Pi Coding Agent](https://pi.dev)** — Inspiration for the rework and simplification

## License

[GNU AGPL-3.0](LICENSE)

**Important Notice:** This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).

**What this means:**

- You are free to use, study, modify, and distribute this software
- Any modifications you make must also be released under AGPL-3.0
- **If you run a modified version of this software as a network service (SaaS, web app, API, etc.), you must make your complete source code available to all users of that service**
- You must provide access to the Corresponding Source under the terms of this License

For more details, see [LICENSE](LICENSE) or [https://www.gnu.org/licenses/agpl-3.0](https://www.gnu.org/licenses/agpl-3.0)
