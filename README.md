# glm-cli

> AI coding agent powered by GLM-4.7

A brutally minimal terminal interface for AI-assisted software development. Built with OpenTUI + SolidJS for flicker-free 60fps rendering.

## Features

- **GLM-4.7** - Zhipu AI's flagship model with thinking mode
- **5 Modes** - AUTO, AGENT, PLANNER, PLAN-PRD, DEBUG
- **MCP Integration** - Vision, Web Search, Web Reader, Zread, Context7
- **Git Checkpoints** - Per-message undo/redo
- **Auto-Compact** - AI summarization at 70% context
- **Auto-Save** - Sessions persist automatically (30s interval)
- **Express Mode** - Skip permission prompts in trusted environments
- **Interactive Overlays** - Model picker, session loader, question prompts

## Visual Preview

**Welcome Screen:**
```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                                                                          ┃
┃     ██████╗ ██╗     ███╗   ███╗       ██████╗██╗     ██╗                  ┃
┃    ██╔════╝ ██║     ████╗ ████║      ██╔════╝██║     ██║                  ┃
┃    ██║  ███╗██║     ██╔████╔██║█████╗██║     ██║     ██║                  ┃
┃    ██║   ██║██║     ██║╚██╔╝██║╚════╝██║     ██║     ██║                  ┃
┃    ╚██████╔╝███████╗██║ ╚═╝ ██║      ╚██████╗███████╗██║                  ┃
┃     ╚═════╝ ╚══════╝╚═╝     ╚═╝       ╚═════╝╚══════╝╚═╝                  ┃
┃                                                                          ┃
┃    v0.8.3                                                      GLM-4.7   ┃
┃    built 01-21-2026                                          ~/project   ┃
┃                                                                          ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

┌─ AUTO ─────────────────────────────────────────────────────────────────────┐
│  > _                                                                       │
└────────────────────────────────────────────────────────────────────────────┘
GLM-4.7 | ~/project | main | MCP: ● | 01-21-2026
```

**Session View:**
```
[GLM-CLI] | Implementing API client
────────────────────────────────────────────────────────────────────────────────

  You                                                            12:34 PM
  Can you help me implement the API client?

  GLM-4.7 [AGENT]                                                12:34 PM
  I'll help you implement the API client.

  ▶ file_write src/api/types.ts                                      [OK]
  ▶ file_write src/api/client.ts                                     [OK]

┌─ AGENT ────────────────────────────────────────────────────────────────────┐
│  > _                                                                       │
└────────────────────────────────────────────────────────────────────────────┘
GLM-4.7 | AGENT | [██████░░░░] 62% | ~/project | main | MCP: ● | 01-21-2026
```

**Loading Animation (DNA Helix Spinner):**
```
┌─ AGENT ────────────────────────────────────────────────────────────────────┐
│  ⣾                                                                         │
│  ⣽  > Thinking...                                                          │
│  ⣻                                                                         │
└────────────────────────────────────────────────────────────────────────────┘
```

**Session Picker (`/load`):**
```
┌─ Load Session ─────────────────────────────────────────────────────────────┐
│                                                                            │
│  NAME                        UPDATED           MSGS   DIRECTORY            │
│                                                                            │
│  Fix API Bug                 2h ago            12     ~/projects/api       │
│  Refactor authentication     Jan 20, 3:45 PM   28     ~/projects/auth      │
│  Session Jan 19              Jan 19            5      ~/glm-cli            │
│                                                                            │
│  ──────────────────────────────────────────────────────────────────────    │
│                                                                            │
│  Preview                                                                   │
│  ────────                                                                  │
│  You: Can you help me fix the API client timeout issue?                    │
│  GLM-4.7: I'll help you debug the timeout...                               │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│  Up/Down: navigate | Enter: load | Esc: cancel                             │
└────────────────────────────────────────────────────────────────────────────┘
```

**Model Picker (`/model`):**
```
┌─ Select Model ─────────────────────────────────────────────────────────────┐
│                                                                            │
│  MODEL              INPUT          DESCRIPTION                             │
│                                                                            │
│  GLM-4.7            text           Flagship - complex coding (current)     │
│  GLM-4.7-FLASH      text           Fast flagship variant                   │
│  GLM-4.6            text           Previous gen flagship                   │
│  GLM-4.6V           text + vision  Image understanding                     │
│  GLM-4.5            text           Efficient general model                 │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│  Up/Down: navigate | Enter: select | Esc: cancel                           │
└────────────────────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Install
bun install -g glm-cli

# Set API key
export GLM_API_KEY=your_key_here

# Run
glm

# Run with Express mode (skip permission prompts)
glm --express
# or
glm -e
```

## Modes

| Mode | Key | Purpose |
|------|-----|---------|
| AUTO | - | AI decides based on prompt |
| AGENT | Tab | Full execution with all tools |
| PLANNER | Tab | Generate project documentation |
| PLAN-PRD | Tab | Quick PRD via Q&A |
| DEBUG | Tab | 7-step systematic debugging |

## Commands

| Command | Description |
|---------|-------------|
| `/new` | New session (clears current) |
| `/clear` | Clear session (alias for /new) |
| `/save` | Save session |
| `/load` | Interactive session picker |
| `/undo` | Revert last change |
| `/redo` | Restore undone |
| `/compact` | Manually compact context |
| `/model` | Interactive model picker |
| `/mode` | Switch mode |
| `/think` | Toggle thinking mode |
| `/express` | Toggle Express mode (skip permissions) |
| `/init` | Analyze project, create AGENTS.md |
| `/stats` | Session statistics |
| `/help` | Show help |
| `/quit` | Exit with summary |

## Keyboard

| Key | Action |
|-----|--------|
| `Tab` | Cycle modes |
| `Shift+Tab` | Cycle reverse |
| `Enter` | Submit |
| `Shift+Enter` | New line |
| `Up/Down` | Message history |
| `@` | File autocomplete |
| `Esc` (2x) | Cancel operation |
| `Ctrl+C` (2x) | Exit with summary |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+P` | Command palette |
| `Ctrl+M` | MCP status |

## Models

| Model | Type | Best For |
|-------|------|----------|
| `glm-4.7` | Text | Complex coding (default) |
| `glm-4.7-flash` | Text | Fast coding |
| `glm-4.6` | Text | Previous flagship |
| `glm-4.6v` | Vision | Image understanding |
| `glm-4.5` | Text | General tasks |
| `glm-4.5-air` | Text | Lightweight |
| `glm-4.5-flash` | Text | Ultra-fast |
| `glm-4.5v` | Vision | Quick image tasks |

## MCP Servers

glm-cli integrates with 5 MCP servers out of the box:

| Server | Type | Tools |
|--------|------|-------|
| **Vision** | Local (stdio) | Image analysis, UI screenshots, diagrams |
| **Web Search** | Remote (HTTP) | Web search via Z.AI |
| **Web Reader** | Remote (HTTP) | Fetch and parse web pages |
| **Zread** | Remote (HTTP) | Search docs, read GitHub repos |
| **Context7** | Remote (HTTP) | Library/framework documentation |

The agent discovers MCP tools on-demand using `/mcp-tools` to keep context lean.

## Configuration

Config file: `~/.glm-cli/config.json`

```json
{
  "apiKey": "your_key_here",
  "defaultModel": "glm-4.7",
  "defaultMode": "AUTO",
  "thinking": true,
  "express": false
}
```

Or use environment variable:

```bash
export GLM_API_KEY=your_key_here
```

## Project Instructions

glm-cli loads project-specific instructions from these files (first found wins):

1. `.glm-cli/instructions.md`
2. `AGENTS.md`
3. `CLAUDE.md`
4. `GEMINI.md`
5. `QWEN.md`
6. `KIMI.md`
7. `COPILOT.md`
8. `.cursorrules`
9. `.windsurfrules`

## Requirements

- Bun 1.0+ or Node.js 20+
- Git (for undo/redo)
- Terminal with 256 colors

## License

MIT
