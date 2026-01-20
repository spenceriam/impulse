# glm-cli

> AI coding agent powered by GLM-4.7

A brutally minimal terminal interface for AI-assisted software development. Built with OpenTUI + SolidJS for flicker-free 60fps rendering.

## Features

- **GLM-4.7** - Zhipu AI's flagship model with thinking mode
- **5 Modes** - AUTO, AGENT, PLANNER, PLAN-PRD, DEBUG
- **MCP Integration** - Vision, Web Search, Web Reader, Zread
- **Git Checkpoints** - Per-message undo/redo
- **Auto-Compact** - AI summarization at 70% context

## Quick Start

```bash
# Install
bun install -g glm-cli

# Set API key
export GLM_API_KEY=your_key_here

# Run
glm
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
| `/new` | New session |
| `/save` | Save session |
| `/load` | Load session |
| `/undo` | Revert last change |
| `/redo` | Restore undone |
| `/model` | Switch model |
| `/mode` | Switch mode |
| `/think` | Toggle thinking |
| `/stats` | Session stats |
| `/help` | Show help |
| `/quit` | Exit |

## Keyboard

| Key | Action |
|-----|--------|
| `Tab` | Cycle modes |
| `Shift+Tab` | Cycle reverse |
| `Enter` | Submit |
| `Shift+Enter` | New line |
| `@` | File autocomplete |
| `Esc` (2x) | Cancel |
| `Ctrl+C` (2x) | Exit |
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

## Configuration

Config file: `~/.config/glm-cli/config.json`

```json
{
  "apiKey": "your_key_here",
  "defaultModel": "glm-4.7",
  "defaultMode": "AUTO",
  "thinking": true
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
