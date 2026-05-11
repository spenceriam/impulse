# IMPULSE

[![npm version](https://img.shields.io/npm/v/@spenceriam/impulse.svg)](https://www.npmjs.com/package/@spenceriam/impulse)
[![build](https://img.shields.io/github/actions/workflow/status/spenceriam/impulse/release.yml?label=build)](https://github.com/spenceriam/impulse/actions/workflows/release.yml)
[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.0-f9f1e1?logo=bun)](https://bun.sh)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

> Terminal-based, provider-flexible AI coding agent

A brutally minimal terminal interface for AI-assisted software development. Provider-flexible model routing, flicker-free rendering, built-in web research tools, and session management - all in your terminal.

<!-- TODO: Add demo GIF -->
<!-- ![IMPULSE Demo](docs/demo.gif) -->

## Features

- **Provider-flexible models** - Use configured providers such as Ollama, OpenRouter, OpenAI, Groq, Gemini, Nous, and Z.ai
- **4 Modes** - WORK, EXPLORE, PLAN, DEBUG (Tab to cycle)
- **Web research tools** - Built-in `web_search` and `web_fetch`, with bundled `agent-browser` fallback
- **Session Management** - Auto-save, load previous sessions, undo/redo via git checkpoints
- **Auto-Compact** - AI summarization at 85% context usage
- **Express Mode** - Skip permission prompts in trusted environments
- **Engage Mode** - High-autonomy execution profile with a distinct status-line indicator
- **Headless Mode** - Run prompts without TUI via `--prompt`

## Installation

```bash
npm install -g @spenceriam/impulse
```

Set an API key for your chosen provider:

```bash
# Z.ai
export ZAI_API_KEY=your_key_here

# Other examples
export OLLAMA_API_KEY=your_key_here
export OPENROUTER_API_KEY=your_key_here

# Or config file (~/.config/impulse/config.json)
echo '{"providers": {"z.ai": {"apiKey": "your_key_here"}}, "defaultProvider": "z.ai", "defaultModel": "z.ai/glm-4.7"}' > ~/.config/impulse/config.json
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
| `-m, --model <model>` | Set provider-prefixed model (for example `ollama/deepseek-v4-pro` or `z.ai/glm-4.7`) |
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
| `Ctrl+M` | Reserved |

## Web Research

IMPULSE includes provider-neutral web tools. The model can use `web_search` to discover current sources and `web_fetch` to read exact URLs. If direct search/fetch fails, IMPULSE falls back to bundled `agent-browser` for browser-backed access.

The old Z.ai-hosted research path (vision, web-search, web-reader, zread) is no longer part of the default tool surface.

## Configuration

Config file: `~/.config/impulse/config.json`

```json
{
  "providers": {
    "z.ai": { "apiKey": "your_key_here" },
    "ollama": { "baseUrl": "https://ollama.com" }
  },
  "defaultProvider": "ollama",
  "defaultModel": "ollama/deepseek-v4-pro",
  "defaultMode": "WORK",
  "reasoningLevel": "medium"
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
- **[Z.ai](https://z.ai)** - For GLM models and the Coding Plan API

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
