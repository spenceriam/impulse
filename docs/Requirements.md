# Requirements

> Functional and non-functional requirements for impulse

Generated: 01-19-2026

---

## Overview

**impulse** is a terminal-based AI coding agent powered by Zhipu AI's GLM-4.x models. It provides a brutally minimal, flicker-free terminal UI for interactive AI-assisted software development.

### Target Users

- Software developers who prefer terminal-based workflows
- Users who want AI coding assistance without leaving the command line
- Developers working with codebases who need intelligent file editing, search, and code generation

### Core Value Proposition

1. **Native Terminal Experience** - No browser, no Electron, pure terminal
2. **Flicker-Free Streaming** - 60fps rendering during AI response streaming
3. **Multiple Modes** - Specialized modes for coding, planning, debugging
4. **Session Persistence** - Save, load, undo/redo across sessions
5. **MCP Integration** - Extended capabilities via Vision, Web Search, Web Reader, Zread

---

## 1. Functional Requirements

### 1.1 Core Chat Interface

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.1.1 | Display chat messages in scrollable conversation view | Must |
| FR-1.1.2 | Support multi-line input with Shift+Enter | Must |
| FR-1.1.3 | Stream AI responses in real-time without flicker | Must |
| FR-1.1.4 | Display thinking blocks (collapsible) during generation | Must |
| FR-1.1.5 | Show ghost text placeholder when input is empty | Should |
| FR-1.1.6 | Support message history navigation with arrow keys | Should |

### 1.2 Mode System

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.2.1 | Support 5 modes: AUTO, AGENT, PLANNER, PLAN-PRD, DEBUG | Must |
| FR-1.2.2 | Cycle modes with Tab / Shift+Tab | Must |
| FR-1.2.3 | Display current mode in status line with mode color | Must |
| FR-1.2.4 | AUTO mode: AI selects appropriate mode based on prompt | Must |
| FR-1.2.5 | AGENT mode: Full tool access with looper skill | Must |
| FR-1.2.6 | PLANNER mode: Generate AGENTS.md and docs/ files | Must |
| FR-1.2.7 | PLAN-PRD mode: Quick PRD via Q&A workflow | Must |
| FR-1.2.8 | DEBUG mode: 7-step systematic debugging process | Must |

### 1.3 Model Selection

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.3.1 | Support 8 GLM models (4.7, 4.7-flash, 4.6, 4.6v, 4.5, 4.5-air, 4.5-flash, 4.5v) | Must |
| FR-1.3.2 | Default to glm-4.7 | Must |
| FR-1.3.3 | Switch models via /model command | Must |
| FR-1.3.4 | Display current model in status line | Should |

### 1.4 Input Handling

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.4.1 | Multi-line paste detection with "[Pasted ~X lines]" display | Must |
| FR-1.4.2 | Image paste detection routed to Vision MCP | Must |
| FR-1.4.3 | @ symbol triggers file/directory autocomplete | Must |
| FR-1.4.4 | Support @~ for home directory search | Should |
| FR-1.4.5 | Support @file#10-20 for line range references | Should |
| FR-1.4.6 | Fuzzy filename matching in autocomplete | Should |

### 1.5 Commands

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.5.1 | /new - Start new session with save prompt | Must |
| FR-1.5.2 | /compact - Manual AI summarization | Must |
| FR-1.5.3 | /save - Save with AI-suggested name | Must |
| FR-1.5.4 | /load - Session picker with preview | Must |
| FR-1.5.5 | /undo - Git-based revert to checkpoint | Must |
| FR-1.5.6 | /redo - Restore undone changes | Must |
| FR-1.5.7 | /model - Switch GLM model | Must |
| FR-1.5.8 | /mode - Switch mode (alt to Tab) | Must |
| FR-1.5.9 | /instruct - Edit project instructions | Should |
| FR-1.5.10 | /config - Basic settings overlay | Should |
| FR-1.5.11 | /stats - Session statistics display | Should |
| FR-1.5.12 | /help - Categorized help overlay | Must |
| FR-1.5.13 | /think - Toggle thinking mode | Must |
| FR-1.5.14 | /quit, /exit - Exit with summary | Must |

### 1.6 Tool System

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.6.1 | File read tool with line range support | Must |
| FR-1.6.2 | File write tool with diff preview | Must |
| FR-1.6.3 | File edit tool for targeted modifications | Must |
| FR-1.6.4 | Glob tool for file pattern matching | Must |
| FR-1.6.5 | Grep tool for content search | Must |
| FR-1.6.6 | Bash tool for command execution | Must |
| FR-1.6.7 | TodoWrite tool for updating task list | Must |
| FR-1.6.8 | TodoRead tool for reading current tasks | Must |
| FR-1.6.9 | Collapsible tool result blocks | Must |
| FR-1.6.10 | Arrow key navigation between tool blocks | Should |

### 1.7 Todo System

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.7.1 | Session-scoped todo list (each session has own todos) | Must |
| FR-1.7.2 | Todo data model: id, content, status, priority | Must |
| FR-1.7.3 | Status values: pending, in_progress, completed, cancelled | Must |
| FR-1.7.4 | Priority values: high, medium, low | Must |
| FR-1.7.5 | TodoWrite replaces entire todo list (full replacement) | Must |
| FR-1.7.6 | TodoRead returns current session todos | Must |
| FR-1.7.7 | Persist todos to storage with session | Must |
| FR-1.7.8 | Display todos in sidebar panel | Must |
| FR-1.7.9 | Collapsible todo section when >2 items | Should |
| FR-1.7.10 | Hide todo section when all tasks completed | Should |
| FR-1.7.11 | Status indicators: [ ] pending, [>] in_progress, [x] completed | Must |
| FR-1.7.12 | Real-time UI update via event bus on todo changes | Must |
| FR-1.7.13 | Agent uses todos proactively for 3+ step tasks | Should |
| FR-1.7.14 | Only ONE todo in_progress at a time (agent guideline) | Should |

### 1.8 Agent System

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.8.1 | Primary build agent with full tool access | Must |
| FR-1.8.2 | Explore subagent for fast codebase search (read-only) | Must |
| FR-1.8.3 | General subagent for complex multi-step tasks | Must |
| FR-1.8.4 | Agent-controlled delegation (no user @ syntax) | Must |
| FR-1.8.5 | Subagent results displayed in collapsible blocks | Should |

### 1.9 MCP Integration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.9.1 | Vision MCP (local stdio) for image analysis | Must |
| FR-1.9.2 | Web Search MCP (remote HTTP) for web queries | Must |
| FR-1.9.3 | Web Reader MCP (remote HTTP) for URL content | Must |
| FR-1.9.4 | Zread MCP (remote HTTP) for repo documentation | Must |
| FR-1.9.5 | Single API key configuration for all MCPs | Must |
| FR-1.9.6 | Ctrl+M for MCP status overlay | Should |
| FR-1.9.7 | Graceful degradation on MCP failure | Must |

### 1.10 Session Management

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.10.1 | Auto-save every 30 seconds | Must |
| FR-1.10.2 | Auto-compact at 70% context usage | Must |
| FR-1.10.3 | AI-generated session names on save | Should |
| FR-1.10.4 | Git-based per-message checkpoints | Must |
| FR-1.10.5 | Session end summary with stats | Must |
| FR-1.10.6 | Preserve thinking content in history | Must |

### 1.11 Project Instructions

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.11.1 | Discover instruction files in priority order | Must |
| FR-1.11.2 | Support 9 formats (.impulse/instructions.md, AGENTS.md, CLAUDE.md, etc.) | Must |
| FR-1.11.3 | Load and apply instructions to system prompt | Must |
| FR-1.11.4 | /instruct command for editing instructions | Should |

---

## 2. Non-Functional Requirements

### 2.1 Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-2.1.1 | Streaming render latency | < 16ms per frame |
| NFR-2.1.2 | Frame rate during streaming | >= 60fps |
| NFR-2.1.3 | Input latency | < 50ms |
| NFR-2.1.4 | Startup time | < 2 seconds |
| NFR-2.1.5 | Memory usage (idle) | < 100MB |

### 2.2 Reliability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-2.2.1 | API retry attempts | 5 with exponential backoff |
| NFR-2.2.2 | Session auto-save interval | 30 seconds |
| NFR-2.2.3 | Crash recovery | Resume from last checkpoint |
| NFR-2.2.4 | MCP failure handling | Graceful degradation |

### 2.3 Usability

| ID | Requirement | Description |
|----|-------------|-------------|
| NFR-2.3.1 | Brutalist aesthetic | No emojis, minimal decoration |
| NFR-2.3.2 | Discoverable shortcuts | Tab for modes, Ctrl+P for palette |
| NFR-2.3.3 | Double-press safety | Esc/Ctrl+C require confirmation |
| NFR-2.3.4 | Clear error messages | Actionable with next steps |

### 2.4 Compatibility

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-2.4.1 | Runtime | Bun 1.0+ / Node.js 20+ |
| NFR-2.4.2 | Terminal | xterm-256color compatible |
| NFR-2.4.3 | Platform | Linux, macOS, Windows (WSL) |
| NFR-2.4.4 | Terminal size | Minimum 80x24 |

### 2.5 Security

| ID | Requirement | Description |
|----|-------------|-------------|
| NFR-2.5.1 | API key storage | Environment variable or secure config |
| NFR-2.5.2 | No credential logging | Keys never appear in logs |
| NFR-2.5.3 | File access | Respect working directory bounds |
| NFR-2.5.4 | Command execution | User confirmation for destructive ops |

### 2.6 Maintainability

| ID | Requirement | Description |
|----|-------------|-------------|
| NFR-2.6.1 | TypeScript strict mode | No any types |
| NFR-2.6.2 | Zod validation | Runtime checks at boundaries |
| NFR-2.6.3 | Modular architecture | Clear separation of concerns |
| NFR-2.6.4 | Test coverage | Critical paths covered |

---

## 3. Constraints

| ID | Constraint | Rationale |
|----|------------|-----------|
| C-1 | Single API endpoint (Coding Plan) | Enables thinking mode, no fallbacks |
| C-2 | OpenTUI + SolidJS | Flicker-free rendering requirement |
| C-3 | No external databases | Session storage is file-based |
| C-4 | Single API key for MCPs | Simplified user configuration |
| C-5 | Conventional commits | Consistent git history |

---

## 4. Assumptions

| ID | Assumption |
|----|------------|
| A-1 | User has valid Z.AI API key |
| A-2 | Terminal supports ANSI colors and Unicode |
| A-3 | Git is installed and available in PATH |
| A-4 | Working directory is a git repository for undo/redo |
| A-5 | Internet connection available for API and MCP calls |

---

## 5. Out of Scope

The following are explicitly NOT part of this project:

| Item | Rationale |
|------|-----------|
| GUI/Desktop Application | Terminal-only by design |
| Web Interface | Terminal-only by design |
| Multi-user/Collaboration | Single-user tool |
| Cloud Storage for Sessions | Local file storage only |
| Plugin System | Keep core simple, use MCP for extensions |
| Custom Model Training | Uses pre-trained GLM models |
| Voice Input/Output | Text-based interaction only |
| IDE Integration | Standalone CLI tool |

---

## 6. Open Questions

| ID | Question | Status | Decision |
|----|----------|--------|----------|
| OQ-1 | Should we support custom MCP servers beyond the 4 Z.AI ones? | Open | - |
| OQ-2 | Should session auto-compact be configurable or fixed at 70%? | Open | - |
| OQ-3 | Should we support multiple concurrent sessions? | Decided | No - single session at a time |
| OQ-4 | Should thinking mode be configurable per-mode or global? | Decided | Global toggle via /think |
| OQ-5 | Should we support theming/color customization? | Open | - |

---

## 7. Related Documents

| Document | Purpose |
|----------|---------|
| [Design.md](Design.md) | Architecture and system design |
| [Tasks.md](Tasks.md) | Implementation tasks (BMAD-method) |
| [specs/tool-descriptions.md](specs/tool-descriptions.md) | Full tool prompt specifications |
| [specs/event-bus.md](specs/event-bus.md) | Event system specification |
| [specs/storage.md](specs/storage.md) | Storage module specification |
