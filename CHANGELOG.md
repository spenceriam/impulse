# Changelog

All notable changes to glm-cli will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] - 2026-01-21

### Fixed

- **`/model` Selection Highlighting** - Fixed bug where all rows showed highlight color; now only selected row is highlighted
- **`/model` Column Alignment** - Added proper column alignment with MODEL, INPUT, DESCRIPTION headers
- **`/model` Descriptions** - Improved model descriptions with input type (text vs text + vision)
- **`/mcp` Column Alignment** - Added header row and consistent column widths for cleaner output
- **System Prompt** - Removed hardcoded model name, strengthened English language instruction

### Changed

- **AGENTS.md** - Added UI Implementation References section (OpenTUI skill, Context7 MCP, codebase patterns)

## [0.3.0] - 2026-01-21

### Added

- **MCP Tool Discovery System** - Agent can now search and inspect MCP tools on-demand via `/mcp-tools` command, keeping tool descriptions out of context until needed
- **Context7 MCP Server** - Added Context7 for library/framework documentation lookup (`resolve-library-id`, `query-docs`)
- **Mode-Aware System Prompts** - System prompts now adapt based on mode (AGENT/DEBUG/AUTO get full MCP discovery workflow, PLANNER/PLAN-PRD get lightweight awareness)
- **Hidden Commands** - Command registry now supports `hidden` flag for internal commands not shown in `/help` or autocomplete
- **`/mcp-tools` Command** - Internal command for agent to search tools across all MCP servers
- **`/model` Interactive Popup** - Model selection now shows interactive overlay instead of text output

### Changed

- **StatusLine** - Now fully reactive with polling for MCP status (2s→30s adaptive) and git branch (5s)
- **InputArea** - Autocomplete stays open when complete command typed, ghost text shows only on first render
- **MCP Manager** - Added actual health checks for HTTP servers (JSON-RPC tools/list) and stdio servers (which executable)

### Fixed

- **Logo Centering** - GLM-CLI ASCII logo now properly centered in welcome screen border frame using flexbox

## [0.2.1] - 2026-01-20

### Fixed

- **Paste Support** - Input components now properly support paste (Ctrl+V / Cmd+V) via textarea `onPaste` event
- **Input Components** - Switched from `<input>` to `<textarea>` with proper event handling following OpenTUI patterns
- **Undo Support** - Native undo (Ctrl+Z / Cmd+Z) now works in text inputs

## [0.2.0] - 2026-01-20

### Added

- **Phase 8: Integration Wiring** - Connected all infrastructure built in Phases 1-7
- **API Key Setup Flow** - App now prompts for Z.AI API key on first launch if not configured
- **Welcome Screen** - ASCII logo display with version, model, and directory info on fresh sessions
- **Streaming Chat** - Messages stream from GLMClient with real-time UI updates
- **Session Persistence** - Sessions auto-save every 30 seconds via SessionManager
- **Session Management Methods** - `createNewSession`, `loadSession`, `saveSession`, `listSessions` in SessionContext

### Changed

- **App.tsx** - Complete rewrite to integrate context providers, API client, and session management
- **SessionContext** - Now integrates with SessionManager/SessionStore for persistence
- **StatusLine** - Uses reactive contexts instead of hardcoded values, shows dynamic progress
- **Config** - API key now optional, enabling first-time setup flow

### Fixed

- **App Not Functional** - App previously showed hardcoded placeholder data; now fully wired up

## [0.1.2] - 2026-01-20

### Fixed

- **ProgressBar Component** - Fixed nested `<text>` elements causing render error. ProgressBar now returns `<span>` for proper inline use within `<text>` elements, following OpenTUI best practices.

## [0.1.1] - 2026-01-20

### Fixed

- **App Entry Point** - Fixed stub entry point that only logged to console instead of rendering the App component
- **Build Script** - Fixed production build to use OpenTUI Solid plugin for proper JSX transformation
- **Bun Configuration** - Fixed bunfig.toml preload configuration that was breaking JSX transformation at runtime
- **Duplicate Render Call** - Removed duplicate `render()` call from App.tsx (now only in index.tsx)
- **Path Security Tests** - Fixed 3 failing tests: proper symlink creation, recursive directory creation, and test isolation

### Changed

- Build script now uses `scripts/build.ts` with the Solid transform plugin instead of raw `bun build`
- Added `@types/bun` to devDependencies for proper Bun type support

## [0.1.0] - 2026-01-20

### Added

#### Phase 1: Foundation
- Project structure with Bun and TypeScript strict mode
- Global paths configuration for config, data, and logs
- File-based storage module with read/write/list/remove operations
- File locking utility for concurrent access protection
- Event bus for decoupled component communication
- Configuration system with Zod validation
- Logger utility with level control and file output
- GLM API client (OpenAI-compatible)
- SSE streaming handler with thinking content extraction
- Instruction file discovery with priority order
- Design constants for colors, indicators, and spacing

#### Phase 2: Core UI + Modes
- OpenTUI App shell with SolidJS integration
- Welcome screen with ASCII logo and version info
- Status line component with model, mode, context usage, git branch, MCP status
- Input area with ghost text and multi-line support
- Chat view with auto-scroll
- Message block with markdown rendering
- Thinking block with collapsible display
- Tool block with diff support
- Sidebar panel with session info, todos, MCP status
- Todo item component with ASCII indicators
- Overlay system for modals
- Mode context for mode state management
- Session context for session state
- Todo context for todo state
- Global keyboard shortcuts (Tab, Ctrl+P/M, Esc, Ctrl+C)

#### Phase 3: MCP Integration
- MCP connection manager with single API key
- Vision MCP (local, stdio) - 8 tools
- Web Search MCP (remote, HTTP) - webSearchPrime
- Web Reader MCP (remote, HTTP) - webReader
- Zread MCP (remote, HTTP) - search_doc, get_repo_structure, read_file
- MCP status overlay

#### Phase 4: Multi-Modal Input
- Paste handler with timing-based detection
- Image paste handler for Vision MCP
- @ reference parser with fuzzy matching
- Autocomplete dropdown for @ references
- Message history navigation (up/down arrows)

#### Phase 5: Agent & Tools
- Tool registry with Zod schema validation
- File system tools: file-read, file-write, file-edit, glob, grep
- Bash tool with safety checks
- Todo system with TodoWrite and TodoRead tools
- Task tool for subagent launching
- Agent orchestrator for coordination
- Build, explore, and general subagents

#### Phase 6: Session Management
- Session store with auto-save (1s debounced)
- Git-based checkpoint system per message
- AI-powered auto-compact at 70% threshold
- Session manager lifecycle (new/load/switch/exit)
- Command registry with argument parsing
- Core commands: /new, /save, /load, /quit, /exit
- Utility commands: /undo, /redo, /compact, /model, /mode, /think
- Info commands: /stats, /help, /config, /instruct

#### Phase 7: Polish + Release
- Centralized error handling with user-friendly messages
- Performance monitoring utilities
- Cache utility for optimization
- 16ms event batching for flicker-free updates

### Technical Details

- **Runtime:** Bun / Node.js 20+
- **Language:** TypeScript (strict mode)
- **UI Framework:** OpenTUI with SolidJS reconciler
- **API:** Z.AI Coding Plan API (OpenAI-compatible)
- **Models Supported:** glm-4.7, glm-4.7-flash, glm-4.6, glm-4.6v, glm-4.5, glm-4.5-air, glm-4.5-flash, glm-4.5v

### Design Principles

- Brutally minimal terminal UI
- High contrast, clear visual hierarchy
- Monospace precision
- No emojis - ASCII indicators only
- Flicker-free 60fps rendering
- Type-safe with Zod validation
