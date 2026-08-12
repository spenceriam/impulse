# impulse

[![npm version](https://img.shields.io/npm/v/@spenceriam/impulse.svg)](https://www.npmjs.com/package/@spenceriam/impulse)
[![build](https://img.shields.io/github/actions/workflow/status/spenceriam/impulse/release.yml?label=build)](https://github.com/spenceriam/impulse/actions/workflows/release.yml)
[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.0-f9f1e1?logo=bun)](https://bun.sh)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

> Provider-flexible terminal AI co-partner agent

A brutally minimal terminal interface for AI-assisted software development. Supports any OpenAI-compatible or Anthropic-compatible provider — Ollama Cloud, OpenRouter, Fireworks, Moonshot, Xiaomi Mimo, and many more. Model discovery, reasoning detection, vision model routing, and session management — all in your terminal.

## Features

- **Custom provider support** — Any OpenAI-compatible or Anthropic-compatible endpoint. Unlimited custom providers with automatic model discovery, reasoning capability probing, and persistent configuration
- **2 modes** — ASK (default, read-only) for research, planning, and diagnosis; AGENT for explicit execution (Tab to toggle)
- **Safe execution handoff** — when ASK reaches an action, choose an isolated preview, switch explicitly to AGENT, or remain read-only
- **Shell commands** — in AGENT, `! ls` or `!ls` runs a command and shows output in the chat history (each run is its own block); `@ <question>` asks the agent to interpret the last shell output with full session context
- **Mid-turn queue** — Messages sent while the agent is working are queued above the prompt; press `↑` on an empty input to edit the next queued message
- **Turn steering** — `/steer <instruction>` redirects the current turn at the next tool step; `/side <question>` opens an isolated side prompt overlay while the main agent works
- **Graceful exit** — `/exit` shows the impulse logo, thanks you, then labeled resume hints: `impulse --resume <id>` from the terminal vs `/resume` when impulse is already running (do not paste both)
- **Startup splash** — GEN-tiny logo and provider/model lines before the TUI; 3s delay skippable with any key
- **Vision** — Automatic when the model supports it; optional vision override in `/settings`. Paste screenshots or attach image paths (`~/…`, relative, `@file.png`)
- **Images** — Attachments appear as `[Pasted image #N]` in chat and tool output
- **Chat view** — `/clear` hides the on-screen transcript while session history stays on disk and in context; `/show` restores the view from the saved session
- **Markdown tables** — Inline `**bold**` in cells, row separators, wrapped wide rows; stable layout while streaming
- **Turn status** — Busy line shows `Processing...` during model/thinking/vision work and `Working...` during tool runs
- **Allow-All** — Allow-All persists globally after a concise acknowledgment; it skips permission prompts but does not sandbox commands or protect files or network access
- **Presentation density** — compact by default, with a persisted comfy option in `/settings`
- **Progressive skills** — `/skills` opens installed skills and their actions without flooding slash autocomplete; the agent matches relevant skills proactively
- **ACP interoperability** — `impulse --acp` exposes the shared session runtime over stable Agent Client Protocol stdio
- **Advisor workflow (experimental)** — Enable via `/experimental`, then `/advisor`; plan/approve/execute with embedded plan markdown
- **Web research** — Built-in `web_search` and `web_fetch` with bundled `agent-browser` fallback
- **Ollama provider** — Full integration with capability discovery via `/api/show`
- **Session management** — `impulse --list-sessions`, `--enrich-session-titles`; `/resume` picker with titles; empty sessions hidden
- **Full-width pickers** — `/model`, `/resume`, and provider setup use arrow-key overlays with wrapped labels
- **Evidence-first debugging** — diagnosis begins read-only in ASK; execution uses safe preview or an explicit switch to AGENT. `/debug` only toggles the session log file
- **Profile** — `/user` overlay to view and edit preferences
- **Parallel sub-agents** — the `task` tool runs up to **8** sub-agents at once (extra tasks queue); batches of **9+** `general` tasks show one approval dialog; per-task progress rows in chat

## Installation

```bash
npm install -g @spenceriam/impulse
```

On first run, impulse will guide you through interactive provider setup. You can also configure providers manually:

```bash
# Environment variables
export OLLAMA_API_KEY=your_key_here
export OPENROUTER_API_KEY=your_key_here

# Or config file (~/.impulse/config.json)
echo '{"providers":{"ollama":{"baseUrl":"https://ollama.com"}},"defaultProvider":"ollama","defaultModel":"ollama/deepseek-v4-pro"}' > ~/.impulse/config.json
```

## Quick Start

```bash
# Start impulse (v1.2.0+ shows co-partner branding in the welcome banner)
impulse

# Development from source
bun run dev

# Re-run provider configuration
impulse --setup

# Run as an Agent Client Protocol stdio server
impulse --acp

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
| `-r, --resume [id]` | Resume a session by id, or open the session picker when omitted |
| `--aa, --allow-all` | Start this process with permission prompts bypassed; does not enable sandboxing |
| `--acp` | Run the stable Agent Client Protocol stdio adapter |
| `-v, --version` | Show version |
| `-h, --help` | Show help |

## Modes

| Mode | Purpose |
|------|---------|
| **ASK** | Default read-only research, planning, and evidence-first diagnosis; offers an isolated preview or explicit handoff when execution is needed |
| **AGENT** | Explicit execution with mutating tools and permission policy enforcement |

Press `Tab` to toggle ASK and AGENT. Press `Shift+Tab` to cycle reasoning levels.

## Vision and images

1. **Attach images** — Paste from the clipboard, type or paste a file path, or include `@path/to/image.png` in your message. The prompt shows `[Pasted image #N]` tokens.
2. **Configure translation** — Use the vision override in `/settings` when you want a dedicated vision model. Native image support is used automatically when available.
3. **Worker sees content** — With `visionMode` on, images are described by the vision model before the worker turn (unless the worker model accepts images natively). If vision is unavailable, impulse reports that clearly.
4. **Describe-only** — The vision prompt follows your message and describes what is visible; it does not push coding tasks unless you asked for them.
5. **Restore transcript** — `/show` replays the session into the chat view (tool blocks render as completed summaries, not a live stream replay).

## Shell commands

| Input | Description |
|-------|-------------|
| `! <command>` or `!command` | Run a shell command; output appears as a block in chat history (not a persistent shell session) |
| `@ <question>` | After a `!` command, ask the agent to interpret that output (full session context; streams in chat) |

While a shell command is running, **Esc twice** or **Ctrl+C** cancels it (chat shows “Shell command cancelled”). Interactive commands (`sudo`, `ssh`) support Cmd/Ctrl+Shift+T takeover when PTY is available.

## Commands

| Command | Description |
|---------|-------------|
| `/skills` | Browse installed skills and skill actions in a dedicated submenu |
| `/ba` | List background jobs; killing or restarting a job requires AGENT |
| `/allow-all` | Persistently toggle PROMPT/ALLOW-ALL approval policy; does not enable sandboxing |
| `/clear` | Clear the on-screen chat view only (session history preserved) |
| `/compact` | Summarize older messages to free context |
| `/experimental` | Toggle experimental features such as advisor, undo, and goal loop |
| `/help` | Scrollable command reference (↑↓ / PgUp/PgDn when the list overflows) |
| `/instructions` | View instructions; persistent changes require AGENT |
| `/model` | Choose or change model; set up provider via API key and endpoint |
| `/mode` | Change mode: ASK (default, read-only) or AGENT (execution) |
| `/new` | Start a new impulse session |
| `/resume`, `/sessions` | Browse and resume saved sessions |
| `/restore`, `/show` | Restore the chat view from session history |
| `/settings` | Configure thinking, reasoning, vision, density, approval policy, and presentation |
| `/steer` | Steer the current turn at its next tool boundary |
| `/update` | Check and install the latest release; requires AGENT |
| `/usage` | Show session token usage and provider quota when available |
| `/user` | View or update profile and preferences |
| `/quit`, `/exit` | End impulse |

Power-user commands remain directly available but stay out of the core help list: `/debug`, `/side`, `/copy`, and `/show`.

After enabling **Advisor** in `/experimental`, these commands also appear in help and autocomplete:

| Command | Description |
|---------|-------------|
| `/advisor` | Configure and toggle advisor model (`on`, `off`, or `<model>`) |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Tab` | Toggle ASK/AGENT, or complete a `/command` when the line starts with `/` |
| `Shift+Tab` | Cycle reasoning level (ignored while typing a `/command`) |
| `↑` | Recall previous prompt; while the agent is working and the queue is non-empty, edit the next queued message |
| `↓` | Clear the prompt input |
| `Enter` | Submit |
| `Esc` (2x) | Abort current agent turn, or cancel a running `!` shell command |
| `Ctrl+C` (2x) | Cancel shell command while running; exit when idle |
| `Ctrl+D` | Exit |

## Web Research

impulse includes provider-neutral web tools. The model can use `web_search` to discover current sources and `web_fetch` to read exact URLs. If direct search/fetch fails, impulse falls back to bundled `agent-browser` for browser-backed access.

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
  "defaultMode": "ASK",
  "approvalPolicy": "prompt",
  "presentationDensity": "compact",
  "reasoningLevel": "medium",
  "visionModel": "openrouter/qwen/qwen2.5-vl-72b-instruct",
  "visionProvider": "openrouter",
  "visionMode": false
}
```

When `visionMode` is `true` and you attach images, impulse runs the configured `visionModel` to produce text descriptions before the worker model's turn (in addition to native multimodal input when the worker supports it).

## Project Instructions

impulse loads project-specific instructions from these files (first found wins):

1. `.impulse/instructions.md`
2. `AGENTS.md`
3. `CLAUDE.md`, `GEMINI.md`, `QWEN.md`, `KIMI.md`, `COPILOT.md`
4. `.cursorrules`, `.windsurfrules`

## Requirements

- **Bun 1.0+**
- Git (recommended)
- Terminal with 256 colors

## Acknowledgements

impulse wouldn't exist without these projects:

- **[pi-tui](https://github.com/mariozechner/pi-tui)** — The terminal UI framework powering the CLI
- **[Bun](https://bun.sh)** — The fast JavaScript runtime
- **[OpenCode](https://opencode.ai)** — The original inspiration
- **[Pi Coding Agent](https://pi.dev)** — Inspiration for the rework and simplification

## Releasing

1. Bump `version` in `package.json` and add a `CHANGELOG.md` section for that version.
2. Merge to `main`. **Release on main** creates tag `vX.Y.Z` when missing, dispatches the **Release** workflow (tags pushed by `GITHUB_TOKEN` do not auto-trigger other workflows), builds platform binaries, uploads a **draft** [GitHub Release](https://github.com/spenceriam/impulse/releases) with attached archives, and publishes `@spenceriam/impulse` to npm when credentials allow.
3. Open the draft release, review notes (from CHANGELOG), and click **Publish release** when ready.

If auto-dispatch fails, run **Actions → Release → Run workflow** with the version from `package.json`.

## License

[GNU AGPL-3.0](LICENSE)

**Important Notice:** This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).

**What this means:**

- You are free to use, study, modify, and distribute this software
- Any modifications you make must also be released under AGPL-3.0
- **If you run a modified version of this software as a network service (SaaS, web app, API, etc.), you must make your complete source code available to all users of that service**
- You must provide access to the Corresponding Source under the terms of this License

For more details, see [LICENSE](LICENSE) or [https://www.gnu.org/licenses/agpl-3.0](https://www.gnu.org/licenses/agpl-3.0)
