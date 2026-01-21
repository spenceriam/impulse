# Changelog

All notable changes to glm-cli will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.9] - 2026-01-21

### Added

- **mcp_discover Tool** - New tool for dynamic MCP tool discovery:
  - `mcp_discover(action: "list")` - List all available MCP servers
  - `mcp_discover(action: "search", query: "...")` - Search for tools by capability
  - `mcp_discover(action: "details", server: "...", tool: "...")` - Get tool details
  - Keeps context window lean by discovering tools on-demand
  - Supports future custom MCP servers (not just hardcoded native ones)

### Fixed

- **Exit Summary** - Fixed showing empty summary even after conversation:
  - Summary now generated from UI context signals (source of truth)
  - No longer relies on stale SessionManager data
  - Displays session name, model, duration, and message count

- **PermissionPrompt Visibility** - Fixed prompt appearing behind chat:
  - Added semi-transparent backdrop overlay
  - Centered position with proper z-index stacking

- **Sidebar Default** - Now visible by default (was hidden):
  - Toggle with Ctrl+B keyboard shortcut

- **Loading Spinner** - Reduced height and improved centering:
  - Reduced from 6 rows to 5 rows
  - Vertically centered against input box

### Changed

- **MCP Tool Discovery** - Replaced hardcoded tool lists with dynamic discovery:
  - System prompt now instructs AI to use `mcp_discover` tool
  - No more hardcoded server/tool lists in prompts
  - Supports future custom MCP servers dynamically

- **Permissions Loosened** - Smarter permission checks:
  - **bash**: Only asks for destructive commands (rm, sudo, git push --force, etc.) or paths outside cwd
  - **file_write**: Only asks for files outside working directory
  - **file_edit**: Only asks for files outside working directory
  - Safe commands (ls, grep, npm run, git status, etc.) auto-approved
  - Build/test commands auto-approved within cwd

- **Permission UI Redesigned** - Matches QuestionOverlay style:
  - Vertical radio list with descriptions (not horizontal buttons)
  - Four options: Allow once, Allow session, Allow always, Reject
  - Shows reason why permission is needed (destructive command, outside cwd, etc.)
  - Shows full target (file path or command)
  - Shows working directory for bash commands
  - Shows old/new strings for edit operations with diff-style coloring
  - Keyboard navigation: ↑/↓, Enter, 1-4 hotkeys, Esc to reject

- **Permission Persistence** - Three-tier approval system:
  - **Allow once**: One-time approval for this specific action
  - **Allow session**: Auto-approve pattern for current session (in-memory)
  - **Allow always**: Persisted to `.glm-cli/permissions.json`, applies to all future sessions

## [0.9.8] - 2026-01-21

### Fixed

- **Thinking Block** - Fixed text visibility and display:
  - Added left border accent (like OpenCode)
  - Text now visible with dim gray color
  - Filters out [REDACTED] content

- **Chat Scroll** - Fixed scrolling behavior:
  - Added `stickyStart="bottom"` for proper auto-scroll to newest content
  - Added `verticalScrollbarOptions` with styled scrollbar
  - Uses `viewportOptions` for proper padding

- **Exit Summary** - Fixed not printing to terminal:
  - Uses `process.stdout.write()` instead of `console.log()`
  - Calls `process.exit(0)` after printing for clean exit

### Changed

- **PermissionPrompt** - Restyled to match brutalist design:
  - Uses `[[━━━]]` bracket frame like welcome screen
  - Added Y/A/N hotkeys for quick responses
  - Proper permission type labels (was showing "unknown")
  - Cyan accent for action icons

## [0.9.7] - 2026-01-21

### Fixed

- **Welcome Screen** - Centered GLM-CLI logo properly:
  - Replaced heavy border with `[[━━━...━━━]]` bracket accents
  - Calculated padding to center logo within frame
  - Version and build info aligned with logo width

## [0.9.6] - 2026-01-21

### Fixed

- **Thinking Block** - Fixed display issues:
  - Default expanded (was collapsed)
  - Added stickyScroll for auto-scroll to bottom during streaming
  - Fixed text color (was black, now dim gray with italics)
  - "Thinking" label visible in both expanded and collapsed states

- **Exit Summary** - Now prints to terminal after app closes (like Gemini CLI):
  - Removed overlay-based exit flow
  - Summary appears in terminal after `/quit` or `/exit`

- **Chat View Border** - Added bordered frame around chat area:
  - Border doesn't break when content is inside
  - Styled scrollbar with cyan thumb and dim track
  - Tight padding to preserve screen real estate

### Added

- **Sidebar Collapse Button** - Clickable `[▶]` icon at bottom right to collapse sidebar

## [0.9.5] - 2026-01-21

### Fixed

- **Command Autocomplete Overlay** - Fixed dropdown appearing behind chat:
  - Lifted autocomplete state from InputArea to App.tsx
  - Render as absolute-positioned overlay at root level
  - Now properly floats OVER chat content

- **Exit Handler** - Fixed `/quit` and `/exit` not showing session summary:
  - Removed `window` reference (doesn't exist in Node/Bun)
  - Added `exitPending` signal to track exit state
  - Summary overlay now displays before app exits

- **Chat Auto-Scroll** - Fixed scrollbox not auto-scrolling during streaming:
  - Wrapped scrollbox in box with `flexGrow={1}` to fill available space
  - `stickyScroll` now works correctly

- **Thinking Display** - Improved reasoning/thinking section:
  - Italics text using `<em>` tag
  - 5-row scrollbox height when expanded
  - Collapsible/expandable with mouse click toggle

- **Permission Prompt** - Added defensive check for null/undefined patterns

## [0.9.4] - 2026-01-21

### Fixed

- **Tool Call Arguments Streaming** - Fixed critical bug where tool calls always failed with invalid JSON:
  - First chunk of tool call arguments was stored in stream state but NOT included in `tool_call_start` event
  - App.tsx initialized `arguments: ""` and only accumulated from deltas, losing the opening `{"`
  - Now `tool_call_start` event includes initial `arguments` field

- **Prompt Box Moving on `/` Command** - Fixed autocomplete dropdown pushing input box down:
  - Changed from normal document flow to `position="absolute"` with `zIndex={100}`
  - Dropdown now floats above input without affecting layout

### Added

- **Thinking/Reasoning Display** - AI thinking content now visible in chat:
  - Added `reasoning` field to Message interface
  - Handle `reasoning` stream events and display above message content
  - Styled with dim text and expand indicator

## [0.9.3] - 2026-01-21

### Fixed

- **ESC Key to Stop Generation** - Fixed critical bug where ESC key never actually stopped AI generation:
  - Converted `streamProcessor` from `let` variable to SolidJS signal (closure was capturing stale value)
  - Added visual warning "Hit ESC again to stop generation" after first ESC press (1.5s timeout)

- **Tool Argument Null Handling** - Fixed critical bug causing `[FAIL] bash - Invalid parameters: timeout: Required`:
  - Z.AI models send `null` for optional fields (e.g., `{"timeout": null}`)
  - Zod's `.optional()` only means "can be omitted" - it rejects `null` values
  - Added `stripNullValues()` to remove nulls before Zod validation in both registry and App.tsx

### Added

- **`tool_stream` Parameter** - Added Z.AI-specific `tool_stream=true` parameter for proper streaming of tool call output

## [0.9.2] - 2026-01-21

### Fixed

- **Tool result message format** - Fixed critical bug where tool results were sent as `user` messages instead of proper Z.AI format:
  - Now uses `role: "tool"` with `tool_call_id` per Z.AI API documentation
  - Each tool result is sent as a separate message (not concatenated)
  - Assistant message content set to `null` (not empty string) when only tool calls exist

## [0.9.1] - 2026-01-21

### Fixed

- **bash tool** - Made `timeout` parameter optional (was incorrectly required, causing "Invalid parameters" errors)
- **MCP discovery** - System prompt now instructs AI to use `/mcp-tools` commands internally without mentioning them to users

## [0.9.0] - 2026-01-21

### Added

- **Tool Calling Support** - AI can now execute tools during conversation:
  - All 11 registered tools (file_read, file_write, file_edit, glob, grep, bash, todo_write, todo_read, task, question, set_header) are now passed to the GLM API
  - Tool schemas converted from Zod to JSON Schema format using `zod-to-json-schema`
  - Tools passed to both initial stream and continuation stream calls

### Technical

- Added `Tool.getAPIDefinitions()` method to `src/tools/registry.ts`
- Converts Zod schemas to OpenAPI 3.0 JSON Schema format
- Updated both `GLMClient.stream()` calls in `App.tsx` to include tools

## [0.8.4] - 2026-01-21

### Fixed

- **Loading Animation Position** - Moved stacked spinner from inside InputArea to App.tsx:
  - Spinner now positioned to the LEFT of the prompt box (not inside it)
  - Fixed 3-char reserved space keeps layout stable (no shifting)
  - 6 spinner rows, centered vertically against 7-line prompt box
  - Added 1-line padding between prompt box and status line to prevent overlap
  - Animation shows during AI processing (responding, tool calls, edits, etc.)

### Technical

- Removed spinner logic from `InputArea.tsx` (component simplified)
- Spinner rendered at `App.tsx` level with `alignItems="center"` for vertical centering
- `paddingTop={1}` offsets spinner to center against taller prompt box

## [0.8.3] - 2026-01-21

### Added

- **Interactive `/load` Session Picker** - `/load` command now opens an interactive overlay:
  - Lists all saved sessions sorted by most recently updated
  - Shows session name, relative time, message count, and working directory
  - Preview panel displays first user/assistant messages from selected session
  - Keyboard navigation (Up/Down to select, Enter to load, Esc to cancel)
  - Empty state guidance when no sessions exist

### Technical

- New `SessionPickerOverlay` component (`src/ui/components/SessionPicker.tsx`)
- Helper functions for relative time formatting and path truncation
- Sessions loaded asynchronously on overlay mount

## [0.8.2] - 2026-01-21

### Added

- **Tool Call Display in Chat** - Tool executions now show inline in assistant messages:
  - Collapsible tool blocks with name, status indicator, and result preview
  - Status indicators: `▶` pending, `⣾` running (animated), `[OK]` success, `[FAIL]` error
  - Recursive tool execution support (AI can chain tool calls)

- **`/clear` Command** - New command to reset the current session (alias for `/new` behavior)

### Fixed

- **`/new` Command** - Now silently resets session without confirmation popup:
  - Clears all messages
  - Resets header to "New session"
  - Resets session context

### Technical

- New `ToolCallInfo` interface in MessageBlock for tool call state tracking
- `executeToolsAndContinue()` function in App.tsx for recursive tool execution
- Tool indicators added to design.ts (`tool.pending`, `tool.running`)
- Message type extended to support `toolCalls?: ToolCallInfo[]`

## [0.8.1] - 2026-01-21

### Fixed

- **Header Separator Line** - Now uses dynamic width instead of hardcoded `.repeat(200)` which caused overflow on smaller screens
- **Header Border Style** - Uses thin border matching input box frame style

### Added

- **Stacked Spinner Animation** - Loading indicator when AI is processing:
  - DNA helix style braille animation (`⣾⣽⣻⢿⡿⣟⣯⣷`)
  - Gradient colors matching GLM-CLI logo (cyan to dim)
  - Staggered/randomized timing for organic feel
  - Positioned to the left of input box, matching its height
  - Input disabled while loading

## [0.8.0] - 2026-01-21

### Added

- **Session Header** - Dynamic header line at top of session screen:
  - Format: `[GLM-CLI] | <context>`
  - AI updates via `set_header` tool at meaningful milestones
  - Prefixes for system actions: `Compacted:`, `Reverted:`, `Reapplied:`
  - Persists with session on save/load

## [0.7.0] - 2026-01-21

### Added

- **Permission System** - Tools now request user approval before executing destructive actions:
  - Edit, write, and bash tools require permission in normal mode
  - Shows inline permission prompt with "Allow once", "Allow always", "Reject" options
  - "Allow always" remembers approval for the session
  - Keyboard navigation: left/right to select, Enter to confirm, Esc to reject

- **Express Mode** - Skip all permission prompts for trusted environments:
  - Enable with `glm-cli --express` or `-e` flag
  - Toggle during session with `/express` command
  - First-time warning overlay explains risks and requires Enter to acknowledge
  - `[EX]` indicator in status line when Express mode is active (orange color)
  - Useful for CI/CD, sandboxed environments, or batch processing

### Technical

- New `Permission` module (`src/permission/`) with ask/respond pattern
- `PermissionPrompt` component for inline permission requests
- `ExpressWarning` overlay for first-time Express mode acknowledgment
- `ExpressProvider` context for managing Express mode state
- Tools call `Permission.ask()` before destructive operations

## [0.6.0] - 2026-01-21

### Added

- **Question Tool** - AI can now ask structured multiple-choice questions during execution:
  - Single-select and multi-select support
  - Keyboard navigation (up/down arrows, Enter to select, Tab for next question)
  - "Other..." option for custom text input
  - Question progress indicator for multi-question flows
  - Promise-based blocking mechanism (tool waits for user response)
  - Integrated with event bus for UI/tool communication

### Technical

- New `QuestionOverlay` component (`src/ui/components/QuestionOverlay.tsx`)
- New `question` tool (`src/tools/question.ts`) with Zod schema validation
- Added `QuestionEvents.Asked` to event bus
- Schema matches OpenCode's question tool for compatibility

## [0.5.0] - 2026-01-21

### Added

- **`/init` Command** - Analyze project and help create/update AGENTS.md:
  - Empty directories: Suggests PLANNER, PLAN-PRD, or AUTO mode to start
  - Existing projects: Analyzes structure, tech stack, git status
  - Returns analysis to AI for intelligent decision-making
  - AI reviews existing AGENTS.md and suggests updates
  - AI can migrate content from CLAUDE.md, GEMINI.md, etc.
  - No `--force` flag needed - AI handles the conversation

### Changed

- **Session View Padding** - Added proper padding to session screen (2 lines top/bottom, 4 chars left/right)
- **StatusLine Position** - Now directly under InputArea (not spanning full width with sidebar)

## [0.4.0] - 2026-01-21

### Added

- **Collapsible Sidebar** - Sidebar can now be toggled with `Ctrl+B`; when collapsed, shows a 1-char strip with vertical "GLM-CLI" branding
- **Mode Display in Messages** - Assistant messages now show mode used (e.g., "GLM-4.7 [AGENT]") with mode-colored brackets
- **Sidebar Context** - New SidebarProvider for managing sidebar visibility state
- **CollapsedSidebar Component** - Clickable 1-char strip to expand sidebar with mouse

### Changed

- **Sidebar Content** - Removed default MCP display (always connected); now shows only:
  - Todo list (always visible, shows "No active tasks" when empty)
  - Custom MCPs (only if user has installed non-default MCP servers)
  - Project file tree (expandable directory structure)
- **Message Type** - Messages now include optional `mode` and `model` fields

## [0.3.3] - 2026-01-21

### Fixed

- **`/model` Column Alignment** - Removed `>` selection indicator (redundant with highlight), aligned header and data columns properly
- **`/model` Current Indicator** - "(current)" text now green colored for better visibility

## [0.3.2] - 2026-01-21

### Fixed

- **`/model` Overlay Width** - Widened overlay to prevent word wrapping in descriptions
- **`/model` Selection** - Removed unnecessary confirmation dialog; model changes immediately on selection
- **Vision MCP Server** - Fixed configuration to use `npx @z_ai/mcp-server` with proper environment variables (Z_AI_API_KEY, Z_AI_MODE)

### Changed

- **MCP Server Config** - Added `command`, `args`, and `env` fields for stdio servers (supports npx-based MCP servers)

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
