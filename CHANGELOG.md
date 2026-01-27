# Changelog

All notable changes to impulse will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.27.23] - 2026-01-27

### Fixed

- **Diagrams now explicitly forbidden in system prompt** - AI behavior fix
  - Mermaid diagrams cannot render in TUI and were showing as raw syntax
  - ASCII art architecture diagrams were breaking terminal rendering
  - Changed from "AVOID" guidance to "NEVER" prohibition - non-negotiable
  - AI now uses bullet points, numbered lists, and prose for architecture
  - Fixes recurring issue where AI would output unrenderable diagrams

## [0.27.22] - 2026-01-27

### Fixed

- **MessageBlock accent lines restored to thin horizontal lines** - Visual fix
  - v0.27.20 incorrectly used half-block characters (`▄`/`▀`) which are too thick
  - Restored original v0.25.0 style using thin horizontal line (`─`) character
  - Half-blocks are only for InputArea, message blocks use thin lines
  - Provides more visual breathing room for message content

## [0.27.21] - 2026-01-27

### Fixed

- **QuestionOverlay scrolling and sizing** - UI regression fix
  - Review screen answer boxes now size dynamically based on content length
  - Added scrollbox around options list to handle many options
  - Increased review scrollbox height to 20 rows (was capped at 16)
  - All 3 questions now visible and scrollable

## [0.27.20] - 2026-01-27

### Fixed

- **Thin accent lines restored on message blocks** - Visual consistency fix
  - MessageBlock accent lines were using solid `backgroundColor` (full row height)
  - Now uses half-block characters (`▄`/`▀`) like InputArea for thin accent lines
  - Affects both AI messages (mode-colored) and user messages (gray)
  - Matches the visual style restored in v0.27.15

## [0.27.19] - 2026-01-27

### Fixed

- **Update completion message now displays (v2)** - More aggressive fix for stdout issues
  - Use `writeSync(1, ...)` for direct file descriptor writes (bypasses all buffering)
  - Call `disableStdoutInterception()` before renderer destroy (releases OpenTUI stdout capture)
  - Add 100ms delay after `renderer.destroy()` to let terminal restore from alternate screen
  - Previous fix (v0.27.18) was insufficient - console.log still captured by OpenTUI

## [0.27.18] - 2026-01-27

### Fixed

- **Update completion message now displays** - Fixed stdout buffering issue
  - Changed from `console.log` to `process.stdout.write` for immediate output
  - Added small delay after npm install to ensure output is flushed
  - Improved messaging to handle version check edge cases
  - Message now shows even if shell path caching causes version mismatch

## [0.27.17] - 2026-01-27

### Fixed

- **Model select overlay now closes on Enter** - Improved UX
  - Previously: Pressing Enter marked the checkbox but overlay stayed open
  - Now: Enter immediately applies model AND closes overlay
  - Added click support: Click any row to select and close
  - Used `batch()` to ensure atomic state updates

## [0.27.16] - 2026-01-26

### Changed

- **Remove redundant model from welcome screen status line** - Cleaner layout
  - Model was shown in 3 places: ASCII banner, input title bar, and status line
  - Now only shown in banner and input title (2 places)
  - Status line format: `⣾ ~/impulse |  main | MCP: ● | ...` (no model)
  - Eliminates visual gap between spinner and directory

## [0.27.15] - 2026-01-26

### Fixed

- **Thin accent lines restored on input area** - Visual regression fix
  - Previously: v0.27.7 changed accent lines from thin half-block characters to solid background colors
  - Problem: Full-height `backgroundColor` boxes created thick, heavy accent lines
  - Now: Restored `▄` (lower half block) and `▀` (upper half block) characters for thin accent lines
  - Matches original v0.25.0 visual style as intended

## [0.27.14] - 2026-01-26

### Fixed

- **Ctrl+C exit now always shows warning** - First Ctrl+C always shows "Exit without saving?" 
  - Previously: Warning only appeared when session had unsaved changes (`isDirty`)
  - Problem: With no visible feedback, users didn't know to press Ctrl+C again within timeout
  - Now: First Ctrl+C always shows warning, second Ctrl+C exits with session summary

- **Input focus after closing changelog overlay** - Textarea now regains focus properly
  - Previously: After closing `/changelog` overlay with Esc, input was unresponsive
  - Fix: Added effect to explicitly refocus textarea when overlay closes

## [0.27.13] - 2026-01-26

### Fixed

- **Command autocomplete position on Welcome Screen** - Dropdown now appears above input
  - Previously: Autocomplete rendered at very bottom of terminal (`bottom=4`)
  - Now: Properly positioned above the input area (`bottom=10`)
  - Overlays the ASCII logo as intended when typing `/` commands

## [0.27.12] - 2026-01-26

### Fixed

- **Auto-updater actually works now** - Complete redesign of the update flow
  - Previously: Attempted to update in-place while app was running (binary locked, couldn't be replaced)
  - Problem: npm install would fail or report success but the old binary remained cached
  - Solution: Exit the app FIRST, then run npm install, then show result in terminal
  - New UX: Shows "Update available: v0.X.Y [Y] Update [N] Dismiss"
  - Press Y or click to update: App exits cleanly, runs npm install with visible output, prompts to restart
  - Press N or click to dismiss: Notification disappears, continue using current version
  - Works on both Welcome Screen and during active sessions

### Removed

- **Old update states** - Removed `installing`, `installed`, `failed` states
  - Simplified to just `checking`, `available`, `none`
  - No more misleading "Update installed, please restart" messages that weren't actually installed

## [0.27.11] - 2026-01-26

### Fixed

- **Welcome screen layout jump** - Fixed extra empty rows appearing after startup
  - The gap between logo and input would shrink then expand during update check
  - Root cause: Gap height was based on `updateState` being truthy, but notification only shows when status !== "checking"
  - Now: Gap only shrinks when there's an actual visible notification (installed/failed)

## [0.27.10] - 2026-01-26

### Fixed

- **Auto-updater reliability** - Fixed false "update failed" messages
  - Previously: Auto-updater would try to verify the installed version by running `impulse --version`
  - Problem: The current process still runs the old binary, and PATH caching often returns the old version
  - This caused misleading "update failed, run npm install" messages even when the install succeeded
  - Now: Trust npm's exit code (0 = success) without attempting verification
  - If npm install succeeds, show "Update installed, restart to apply" instead of false failure

## [0.27.9] - 2026-01-26

### Fixed

- **Ctrl+C session summary** - Double Ctrl+C now shows session summary like `/exit` command
  - Previously: Double Ctrl+C exited without showing any session statistics
  - Now: Shows same formatted summary as `/exit` and `/quit` commands
  - Includes session name, model, duration, tool stats, token usage, and continuation hint
  - Extracted `generateSessionSummary()` helper for code reuse

## [0.27.8] - 2026-01-26

### Added

- **Changelog command and CLI flag** - View release history directly from IMPULSE
  - `/changelog` command opens scrollable overlay showing release history
  - `--changelog` or `-cl` CLI flag prints last 10 releases to stdout
  - Fetches changelog directly from GitHub repository (always in sync)
  - Overlay shows 20 releases initially with "Load more" pagination
  - Displays version, date, release type badge (MAJOR/MINOR/PATCH), and changes
  - Scrollbar and keyboard navigation for browsing entries

## [0.27.7] - 2026-01-26

### Fixed

- **Shift+Tab mode cycling conflict** - Fixed Shift+Tab changing modes when permission prompt is visible
  - Root cause: App.tsx keyboard handler wasn't properly blocking Tab/Shift+Tab when permission prompt was shown
  - Fix: Added explicit `pendingPermission()` check alongside `isOverlayActive()` to ensure mode cycling is blocked
  - Shift+Tab in permission prompt now correctly triggers "Allow All Edits" instead of cycling modes

- **Activity status messages** - Fixed incorrect status messages for tool actions
  - `bash` commands now show "Running..." instead of "Editing documents..."
  - `task` (subagent) now shows "Running..." 
  - `todo_write`, `set_header`, `set_mode` now show "Planning..."
  - `question` now shows "Asking questions..."
  - File operations (`file_read`, `glob`, `grep`) show "Reading files..."
  - File edits (`file_write`, `file_edit`) show "Editing files..."

- **ThinkingBlock visual jitter** - Fixed glitchy scrolling during AI thinking
  - Root cause: Dynamic height calculation during streaming caused layout thrashing
  - Fix: Collapsed uses fixed 5-row height with auto-scroll; expanded shows actual content height (max 50 rows)
  - Auto-scroll to bottom still works smoothly during streaming

- **Accent line width mismatch** - Fixed visual inconsistency between accent lines and backgrounds
  - MessageBlock: Background was extending beyond accent lines on the right
  - InputArea: Accent lines weren't reaching full width of background
  - Fix: Use solid background color boxes instead of repeated text characters for accent lines
  - All accent lines now perfectly match their container widths

## [0.27.6] - 2026-01-26

### Fixed

- **Permission UI empty fields bug** - Tool and Action fields now display correctly
  - Root cause: SolidJS Show component's `when` clause used `pendingPermission() && !express()` which returns boolean `true` instead of the PermissionRequest object due to JavaScript's `&&` operator behavior
  - Fix: Swapped operand order to `!express() && pendingPermission()` so the object is returned

- **AI rejection behavior** - AI now correctly handles user permission rejection
  - Previous: AI interpreted rejection as tool failure, tried to retry or apologize
  - Now: Error message includes `[USER DECISION]` prefix with clear behavioral guidance
  - AI instructed to acknowledge decision and wait for user guidance, not retry

### Changed

- **Permission UI "Allow session" layout** - Sub-choices always visible
  - "Allow session" is now a non-selectable visual header
  - Two sub-options displayed beneath: "This exact command" and "All [tool] commands"
  - Uses radio buttons `( )` for sub-options vs checkboxes `[ ]` for main options
  - 5 selectable items total: Allow once, exact, wildcard, Allow always, Reject

### Added

- **Shift+Tab "Allow All Edits"** - Quick approve file operations for session
  - Only auto-approves `file_edit` and `file_write` (NOT bash, task, etc.)
  - Session-scoped only (NOT persisted on /save + /load)
  - Only works in AUTO, AGENT, DEBUG modes
  - In read-only modes (EXPLORE, PLANNER, PLAN-PRD): shows flash notification for 5 seconds
  - Hint text updated to show Shift+Tab option

- **Status line flash notifications** - Temporary messages right of model name
  - Displays in mode color, auto-dismisses after 5 seconds
  - Used for read-only mode warnings and other brief notifications

## [0.27.5] - 2026-01-26

### Added

- **Mouse click support for Permission UI** - Click on any option to select and confirm it

## [0.27.4] - 2026-01-26

### Fixed

- **Permission UI redesign** - Clearer, more usable permission prompts
  - Shows tool name prominently at top (e.g., "Tool: bash")
  - Displays actual command/file path being requested
  - Added "Allow session (tool/*)" wildcard option to approve all actions of a type
  - Removed number key shortcuts (1-4) - must use arrow keys + Enter
  - Fixed input interference - arrow keys no longer trigger history navigation

### Changed

- **Input disabled during overlays** - Keyboard events properly blocked when permission prompt or other overlays are active

## [0.27.3] - 2026-01-26

### Changed

- **Remove Gutter component** - Simpler, cleaner layout
  - Removed vertical line on left side of chat area
  - Symmetric padding (4 chars left/right) throughout session view
  - Header, chat, prompt, and status line all aligned consistently

- **Braille wheel spinner** - Smoother loading animation
  - Changed from fill blocks (░▒▓█▓▒) to braille wheel (⣾⣽⣻⢿⡿⣟⣯⣷)
  - Faster animation: 80ms/frame (was 150ms) for smoother appearance
  - Full rotation in 640ms

## [0.27.2] - 2026-01-26

### Fixed

- **Status line spinner position** - Spinner now correctly appears left of model name
  - Root cause: `<Show>` conditional rendering was inserting spinner at wrong position
  - Fix: Always render spinner element, show space when idle, animated char when loading

## [0.27.1] - 2026-01-26

### Fixed

- **Input disabled during AI processing** - Can now type while AI is processing (enables queue system)
- **StatusLine spinner overlap** - Spinner no longer overlaps version number on right edge
- **QuestionOverlay crash** - Fixed TextNodeRenderable error from nested text elements
- **QuestionOverlay title quote** - Strip stray quotes from AI-generated context
- **QuestionOverlay width** - Increased from 76 to 90 chars for better readability

### Changed

- **ThinkingBlock background** - Now uses mode's background color (darkened) instead of hardcoded purple

## [0.27.0] - 2026-01-26

### Added

- **Message queue system** - Type messages while AI is processing
  - Messages are queued and automatically sent when AI finishes
  - Queue indicator in status line shows "Queue: N" when messages waiting
  - Auto-send pauses if queue overlay is open (user reviewing)

- **Queue overlay (Ctrl+Q)** - Manage queued messages
  - View all queued messages with timestamps
  - Edit message content (press 'e')
  - Delete individual messages (press 'd')
  - Reorder queue (Ctrl+K/J to move up/down)
  - Send message immediately (Enter)
  - Clear entire queue (Ctrl+C)

- **PTY infrastructure** - Foundation for interactive terminal commands
  - node-pty + @xterm/headless for pseudo-terminal support
  - Bash tool supports `interactive=true` parameter
  - Automatic prompt detection (y/n, password, sudo, continue)
  - Bus events for PTY lifecycle (Started, Output, PromptDetected, Exited)

### Changed

- **Consistent model display names** - Uniform format across all UI
  - "GLM 4.7-Flash" instead of inconsistent "GLM-4.7-FLASH" or "glm-4.7-flash"
  - Updated: WelcomeScreen, StatusLine, MessageBlock, InputArea, ModelSelectOverlay
  - Centralized in `getModelDisplayName()` function

### Documentation

- **Interactive PTY UI** planned for future release
  - Live terminal output display component
  - AI-suggested responses for interactive prompts
  - Documented in AGENTS.md Future Work section

## [0.26.0] - 2026-01-26

### Added

- **Auto-formatter system** - Automatically formats files after write/edit operations
  - Detects project formatters (Prettier, Biome, gofmt, rustfmt, ruff, etc.)
  - 20+ formatters supported based on OpenCode's formatter system
  - Runs silently after file_write and file_edit tool executions
  - Uses Bus events for clean decoupling from tool execution

- **Prompt copy shortcut** - Shift+Ctrl+C copies prompt text to clipboard
  - Only copies if prompt box has text
  - Shows "Copied" indicator in input area
  - Uses same clipboard infrastructure as message copy

### Changed

- **Read-only tool display** - file_read, glob, grep now show as minimal one-liners
  - No expand option, just dim status indicator + title
  - Reduces visual noise for common read operations
  - Verbose mode (`/verbose`) still shows full details

### Documentation

- **Terminal Focus Mode** planned for future release
  - Ctrl+F to focus into expanded terminal output
  - Keyboard scrolling within terminal (documented in AGENTS.md)

## [0.25.0] - 2026-01-26

### Added

- **Status line spinner** - Visual processing indicator in status bar
  - Fill progression animation: `░ ▒ ▓ █ ▓ ▒` (150ms per frame)
  - Appears left of model name when AI is processing
  - Stops during overlays (QuestionOverlay, PermissionPrompt)

- **Terminal output component** - Proper terminal-style display for bash commands
  - Shows command with `$` prompt and working directory
  - Click to expand/collapse output (5 lines collapsed, 15 lines expanded)
  - Shows exit code in red for failed commands
  - Scrollable when expanded

- **File write diffs** - file_write tool now generates and displays diffs
  - New files show all lines as additions
  - Overwrites show before/after changes

### Changed

- **DiffView enhanced with line numbers** - Proper line number display
  - For edits: dual column showing old line -> new line mapping
  - For new files: single column with sequential line numbers
  - Context lines show both line numbers, additions/deletions show relevant one

- **Gutter simplified** - Removed color-cycling animation
  - Now displays static dim line (cleaner, less distracting)
  - Spinner moved to status line for better visibility

## [0.24.6] - 2026-01-26

### Added

- **Click-to-copy on messages** - Click any message block to copy its content to clipboard
  - Works for both user and AI messages
  - Uses OSC 52 for SSH compatibility with native clipboard fallbacks
  - Shows "Copied" indicator in the input area for 2 seconds

- **`/clipboard` command** - View copy history within session
  - Shows up to 20 most recent copied items with timestamps
  - `/clipboard clear` to clear history
  - History is cleared when session resets

### Changed

- **PermissionPrompt redesigned** - Now matches ModelSelectOverlay styling
  - Centered overlay with table layout
  - Cyan highlight for allow options, red for reject
  - Shows contextual info (file paths, commands, diffs)

### Fixed

- **Model name consistency** - Turn footer now shows uppercase model names (GLM-4.7 not glm-4.7)

## [0.24.5] - 2026-01-26

### Fixed

- **QuestionOverlay text wrapping** - Long custom answers now wrap and scroll properly
  - "Type your own answer" input is now a 3-line scrollable box (was single line that overflowed)
  - Review screen answer boxes wrap text at 64 chars with vertical scroll
  - No more text disappearing past the visible area

- **Review screen navigation** - Improved flow for editing answers
  - `Esc` now goes back to answering mode (was canceling entirely)
  - `Tab`/`↑`/`↓` navigate between fields
  - Mouse scroll and PageUp/PageDown scroll within focused field

### Changed

- **Muted mode background colors** - Added gray to mode tints for softer appearance
  - AI message blocks now have more subtle, muted background colors
  - Reduces visual intensity while maintaining mode distinction

## [0.24.4] - 2026-01-25

### Fixed

- **Auto-updater race condition** - Fixed issue where update events could be emitted before the Bus subscription was ready
  - Moved `runUpdateCheck()` call to after `Bus.subscribe()` is set up
  - This ensures update notifications are properly received and displayed

### Added

- **"Checking for updates..." indicator** - Brief visual feedback during update check
  - Shows for ~500ms at startup while checking npm registry
  - Disappears automatically if no update is available

## [0.24.3] - 2026-01-25

### Added

- **Turn footer on AI messages** - Shows model, mode, and timestamp at bottom right of completed turns
  - Format: `GLM-4.7 | AGENT | 12:34 PM`
  - Only visible after streaming completes (not during generation)

- **`set_mode` tool** - AI can now programmatically switch modes mid-conversation
  - Emits event that updates UI mode and message block styling
  - Guidelines built into tool description for when to switch

- **Command aliases** - Commands can now have multiple names
  - `/details` is now an alias for `/verbose`

### Changed

- **Mode-specific backgrounds for AI messages** - Each mode now has a subtle tinted background
  - AUTO: neutral dark gray (#1a1a1a)
  - EXPLORE: dark green tint (#0d1a0d)
  - AGENT: dark cyan tint (#0d1a1a)
  - PLANNER: dark purple tint (#1a0d1a)
  - PLAN-PRD: dark blue tint (#0d0d1a)
  - DEBUG: dark orange/red tint (#1a0d0d)

- **Thinking block auto-collapses** - When streaming ends, thinking section automatically collapses
  - User can still expand manually to review reasoning
  - Reduces clutter for completed messages

- **Mode and model tracked on messages** - Assistant messages now store the mode/model used
  - Enables accurate footer display
  - Mode updates in real-time if AI switches modes mid-turn

### Fixed

- **Content looping bug** - Fixed AI content being repeated 4x during tool continuations
  - Root cause: Total accumulated content was being sent as each turn's content
  - Now properly tracks "content from this turn" vs "total for UI display"

- **Excessive blank lines** - Normalized whitespace when joining content sections
  - Added `joinContentSections()` helper that trims and joins with proper paragraph breaks
  - Prevents double/triple blank lines in conversation

## [0.24.2] - 2026-01-25

### Fixed

- **Tool calls now stay visible after completion** - Previously tools would disappear after execution
  - Tools now remain as collapsed summaries showing what actions were taken
  - Click to expand and see details (diff, output, etc.)

- **TextNodeRenderable errors in multiple components** - Fixed JSX rendering crashes
  - QuestionOverlay: Fixed nested text elements and undefined value handling
  - TodoOverlay: Fixed string concatenation and strikethrough display
  - StatusLine: Fixed template literal formatting
  - CollapsibleToolBlock: Fixed string concatenation in indicators

## [0.24.1] - 2026-01-25

### Added

- **`--check-update` flag** - Debug utility to check for updates without starting TUI
  - Run `impulse --check-update` to see current version and check npm registry
  - Useful for troubleshooting auto-update issues

- **Debug logging for update checker** - When running with `--verbose`, logs update check details
  - Logs version comparison, registry fetch status, install attempts
  - Writes to stderr with `[UPDATE timestamp]` prefix

## [0.24.0] - 2026-01-25

### Added

- **`/todo` command** - View todo list in overlay when TodoBar is hidden
  - Shows all todos with status indicators and priority markers
  - Useful for reviewing session accomplishments after all tasks complete
  - Press Esc to close

- **PageUp/PageDown keyboard shortcuts** - Fast scrolling through chat history
  - Scrolls 20 lines per keypress
  - Only active when AI is not processing

- **5x faster mouse wheel scrolling** - Practical scroll speed for long conversations
  - Uses custom `FastScrollAcceleration` class
  - Default speed increased from 1 to 5 lines per tick

### Changed

- **Single message block per AI turn** - Tool continuations now update the same message
  - Previously each tool call + continuation created separate "GLM-4.7" blocks
  - Now one block per turn that updates in place, appending content
  - Cleaner, less cluttered conversation view

- **Tools hidden when complete** - Tool calls cleared from UI after execution
  - Tools visible while running (shows progress)
  - Disappear after completion - only final text response shown
  - Reduces visual noise in conversation

- **Scroll behavior overhaul**
  - Scroll locked to bottom during AI processing (can't scroll up while responding)
  - Free scrolling when AI is done
  - Uses `scrollTo(100_000)` for reliable positioning

- **User message accent color** - Changed from cyan to gray
  - User messages: Gray accent lines (neutral)
  - AI messages: Mode-colored accent lines (cyan/green/purple/etc.)
  - Clear visual distinction between user and AI turns

- **`/usage` display improvements**
  - Header now says "TOKENS (5-hour window)" for clarity
  - Main line: `Consumed X / Y (Z%)` format
  - Reset time shown in 3 formats: relative, UTC, and local timezone

- **Todo checkmark indicator** - Changed `[x]` to `[✓]` for completed tasks

- **TodoBar redesign**
  - Counter on LEFT: `Todo (2/5)`
  - Collapse button on RIGHT: `[−]`/`[+]`
  - Panel completely hidden when all tasks complete (no "All complete" message)

### Fixed

- **Update failure messages** - Now shows actual error reason
  - Displays permission errors, timeouts, and other failure details
  - Two-line format: error message + manual command
  - Helps users understand why auto-update failed

## [0.23.0] - 2026-01-25

### Added

- **`/verbose` command** - Toggle verbose tool display mode
  - In verbose mode, all tool calls default to expanded view
  - In normal mode (default), tools are collapsed with click-to-expand

- **Version in status line** - Version number now shown at right of status bar

### Changed

- **Todo UI complete redesign** - New stacked panel layout above input
  - Fixed 5-row height with scrollbar when overflow
  - Alternating row backgrounds for easy scanning
  - Counter shows incomplete/total (e.g., `2/5`)
  - Auto-scrolls to keep in_progress task at top
  - Collapses to "All tasks complete" when done
  - Hidden when no todos exist
  - Status indicators: `[>]` in_progress, `[ ]` pending, `[x]` completed, `[-]` cancelled
  - Cancelled tasks show strikethrough on entire line (including indicator)

- **Header line** - Added subtle background color and spacing below title
  - Distinct visual separation from chat content

- **ThinkingBlock improvements**
  - Different background color (`#1a1525` purple tint) for better distinction
  - Expand/collapse only shown when content exceeds 5 rows
  - Simpler display for short thinking content

### Fixed

- **Todo incomplete filter** - Now properly excludes both completed AND cancelled todos

## [0.22.0] - 2026-01-25

### Fixed

- **Context window calculation** - Now uses actual `prompt_tokens` from API responses instead of cumulative token estimates
  - StatusLine progress bar accurately reflects current context usage
  - CompactManager estimation includes system prompt overhead (~5000 tokens)

- **PLANNER/PLAN-PRD mode restrictions** - Modes now properly enforce write restrictions
  - PLANNER mode: Can only write to `docs/` directory
  - PLAN-PRD mode: Can only write `PRD.md` files
  - Tool filtering removes write tools from these modes' API calls
  - Handler-level validation as backup enforcement

- **Permission prompt UI** - Fixed magenta background color issue
  - Removed rgba background (causes color errors in OpenTUI)
  - Uses border with warning color instead
  - Action message now prominent at top

- **Command list escape** - Single Esc now closes command autocomplete before other actions

- **Command menu scrolling** - Keyboard down now properly scrolls through long command lists
  - Uses windowed view approach (10 items visible)
  - Shows "X more..." indicators when items are hidden

- **Paste indicator** - Now shows `[Pasted ~N lines]` for substantial pastes
  - Uses timing-based detection as backup when onPaste doesn't fire
  - Triggers for >= 3 lines or > 150 characters

- **ChatView auto-scroll** - Scrolls to bottom when user sends message or loads session
  - Uses programmatic `scrollToBottom()` on message changes

- **`/compact` behavior** - Removed confirmation popup, now runs silently
  - Shows "what next?" message even when nothing needs compaction

### Changed

- Mode-aware tool filtering - API calls now only include tools appropriate for current mode

## [0.21.0] - 2026-01-25

### Added

- **`/usage` command** - Check Z.AI Coding Plan quota and usage
  - Shows API call limits (TIME_LIMIT) with remaining/total
  - Shows token usage with remaining and percentage
  - Displays next reset time in both UTC and local timezone with countdown
  - Per-model usage breakdown when available

### Fixed

- **Session picker (`/load`)** - Overlay now closes immediately after selecting a session
- **Session message restoration** - Tool calls and reasoning content now properly restored when loading saved sessions
  - Previously showed empty messages for assistant responses that only contained tool calls
  - Now displays tool names, arguments, and results correctly

## [0.20.2] - 2026-01-25

### Fixed

- **Exit summary** - Compacted from ~32 lines to ~12 lines with aligned columns
- **WelcomeScreen update banner** - Update notifications now show on the ASCII logo screen (not just session view)
- **Command menu positioning** - Menu now renders centered above input on WelcomeScreen (was rendering to the left)

## [0.20.1] - 2026-01-25

### Fixed

- **Auto-updater** - Fixed update verification and location detection
  - Now actually verifies installed version by running `impulse --version`
  - Detects global vs local install and updates the correct location
  - Better error messages for permission issues
  - Previously would say "installed" even when update didn't apply

## [0.20.0] - 2026-01-25

### Fixed

- **API message serialization** - Fixed duplicate assistant messages being sent to API
  - Tool calls now properly include `tool_calls` array in conversation history
  - Tool results now sent as `role: "tool"` messages with `tool_call_id`
  - Added `buildAPIMessages()` helper for correct conversation serialization
  - Prevents API confusion from back-to-back assistant messages

### Added

- **EXPLORE mode** - New read-only mode for conversational codebase exploration
  - Patient, curious, anticipatory personality (like ChatGPT with codebase awareness)
  - Suggests mode switches at natural inflection points
  - Available via Tab cycling or `/mode explore`
  - Green color (`#6fca6f`) to distinguish from other modes

### Changed

- **Mode switching awareness** - All modes now suggest switching when conversation shifts
  - EXPLORE suggests PLAN-PRD/PLANNER/DEBUG based on user intent signals
  - Modes transition naturally at meaningful inflection points

- **webSearchPrime MCP** - Fixed parameter name from `query` to `search_query` (Z.AI requirement)

- **Question tool enforcement** - Strengthened system prompt to always use structured questions

- **Debug logging** - Added `--verbose` flag for API debugging
  - Logs to `~/.config/impulse/debug/session-<timestamp>.jsonl`
  - Captures: user messages, API requests, tool executions, errors

- **QuestionOverlay UI** - Multiple visual and interaction fixes
  - Removed magenta background overlay (matches other overlays now)
  - Tab no longer changes modes when overlay is active
  - Tab navigation wraps around topics correctly
  - Removed `[0]` prefix from "Type your own answer"

## [0.19.1] - 2026-01-25

### Fixed

- **grep tool** - Fixed critical bugs preventing proper operation
  - Command args now properly constructed as array elements (was passing string)
  - Include filter (`-g` flag) now works correctly
  - Removed broken post-filter logic that never matched

### Changed

- **grep tool** - Performance and token efficiency improvements
  - Results capped at 100 matches (prevents token overflow)
  - Line content truncated to 120 characters (saves tokens)
  - Max 10 matches per file (prevents single file dominating results)
  - Removed expensive mtime sorting (faster execution)

- **glob tool** - Performance and token efficiency improvements
  - Results capped at 1000 files (prevents massive outputs)
  - Removed expensive mtime sorting (faster execution)
  - Added `nodir: true` to only return files, not directories

- **QuestionEvents schema** - Fixed type mismatch with question tool
  - Updated to use `topic` instead of `header` (matching v0.19.0 changes)
  - Added missing `context` field

## [0.19.0] - 2026-01-25

### Added

- **Tab-Based Question UI** - Complete redesign of the question overlay
  - Topics shown as navigable tabs: `[ Project setup ] [ UI stack ] [ CI/CD ]`
  - Tab/Shift+Tab navigation between topics
  - Completed tabs show checkmark indicator
  - Maximum 3 topics per question batch (AI sends follow-ups if needed)

- **Review Screen** - Confirm answers before submission
  - Shows all answers in scrollable list with editable text boxes
  - Tab between fields to edit any answer
  - Press 'e' to go back to original question options
  - Enter submits all, Esc goes back to editing

- **"Type Your Own Answer"** - Improved custom input flow
  - Always visible as last option in each topic
  - Expands to show text input when selected
  - Collapses when navigating away (remembers text)
  - Esc while typing closes input without losing data

### Changed

- **Question Schema** - Updated data model for topic-based questions
  - New `topic` field (max 20 chars) replaces `header`
  - `context` field moved to top level (shown in overlay header)
  - Max 3 questions enforced via Zod schema

- **System Prompt** - Enhanced AI guidance
  - Strong enforcement to use question tool (not plain text questions)
  - Clear instructions for topic-based batching (max 3)
  - Architecture diagram guidance (avoid complex Unicode box-drawing)
  - Examples updated for new schema format

- **Input Box Height** - Increased from 3 to 4 rows for visual breathing room

## [0.18.1] - 2026-01-24

### Fixed

- **StartOverlay footer layout** - Fixed overlapping text in welcome screen footer
  - `border={["top"]}` syntax not supported in OpenTUI
  - Changed to manual separator line with `"─".repeat(81)`
  - Creator credit and BETA status now display correctly

## [0.18.0] - 2026-01-24

### Added

- **Activity Status Indicators** - Tool calls now grouped by activity type with status labels
  - "Reviewing documents..." when reading files
  - "Editing documents..." when writing/editing files
  - "Using Web Search (MCP)..." when using MCP servers (shows server name)
  - "Clarifying with questions..." when AI uses question tool
  - Labels only appear while activity is in progress

- **Question Tool Context Field** - AI can now explain WHY it's asking a question
  - New `context` field in question schema
  - Header shows "CLARIFYING: <context>" instead of just the header text
  - Helps users understand the purpose of AI questions

### Changed

- **Question Overlay Redesign** - Complete visual overhaul for better usability
  - 2-column grid layout instead of vertical list
  - Numbered hotkeys (1-9 for options, 0 for "Other")
  - Keyboard navigation with arrow keys in grid pattern
  - Visual feedback with borders on hover/selection
  - Semi-transparent backdrop overlay
  - Header increased from 12 to 30 characters max

### Fixed

- **Question Tool UX Confusion** - Users now understand what AI is asking and why
  - Previously the header just showed a short label with no context
  - Now shows full context explaining the clarification needed

## [0.17.1] - 2026-01-23

### Fixed

- **App crash on API key screen** - Fixed nested `<text>` elements causing OpenTUI render error
  - Bug was introduced in v0.16.3, manifested only when no API key configured
  - Error: "TextNodeRenderable only accepts strings, TextNodeRenderable instances, or StyledText instances"
  - Changed nested `<text>` to adjacent `<text>` elements in `<box flexDirection="row">`

## [0.17.0] - 2026-01-23

### Added

- **Z.AI Preserved Thinking** - Reasoning content now sent back to API in multi-turn conversations
  - Improves model performance and reasoning continuity
  - Increases cache hit rates, reducing token costs
  - `/think` toggle now actually controls the thinking parameter sent to Z.AI

- **Z.AI Cache Tracking** - Cache statistics now populate from API response
  - Shows actual cached tokens in exit summary
  - Extracted from `prompt_tokens_details.cached_tokens`

- **Interleaved Thinking with Tools** - Reasoning included in tool continuation messages
  - When assistant makes tool calls, reasoning is preserved
  - Helps model reason about tool results in context

### Changed

- **Thinking configuration** - Now sends `thinking` parameter to Z.AI API
  - `type: "enabled" | "disabled"` controlled by `/think` toggle
  - `clear_thinking: false` enables preserved thinking by default

- **Token usage tracking** - Now includes `cacheRead` from API response
  - Previously hardcoded to 0, now shows actual savings

## [0.16.4] - 2026-01-23

### Added

- **Subagent delegation guidance** - System prompt now guides the AI on when/how to use subagents
  - Clear instructions for using `explore` vs `general` subagents
  - Examples of parallel execution patterns
  - Emphasis on offloading work to keep context clean

- **Thoroughness levels for explore subagent** - New optional parameter
  - `quick`: 1-2 searches, return first findings
  - `medium`: 3-5 searches, follow promising leads (default)
  - `thorough`: Comprehensive search across all paths

### Changed

- **Task tool description** - More prescriptive guidance on when to use subagents
  - Strongly encourages subagent use for codebase exploration
  - Documents parallel execution capability
  - Clearer examples and use cases

### Fixed

- **Empty message appearing in chat** - Fixed missing `streaming: true` flag on continuation messages
  - After tool execution, the continuation message now properly shows "Thinking..." animation
  - Also fixed missing `streaming: false` update when continuation stream completes

## [0.16.3] - 2026-01-23

### Added

- **Unknown flag validation** - CLI now fails with helpful error for unknown flags
  - Example: `impulse --v` now shows "Unknown option: --v" instead of starting the app
  - Directs users to run `impulse --help` for usage information

### Changed

- **API key screen redesign** - Improved first-run experience
  - New title: "Welcome to IMPULSE"
  - Explains Z.ai Coding Plan vs standard API
  - Direct link to get API key: https://z.ai/manage-apikey/subscription

- **Windows ARM64 error message** - Clear error when platform is unsupported
  - Lists supported platforms and notes Windows ARM64 is pending Bun support

### Fixed

- **Invalid URL** - Fixed `z.ai/coding` to valid `z.ai/manage-apikey/subscription`

## [0.16.2] - 2026-01-23

### Added

- **LICENSE file** - Added MIT license file (was declared in package.json but missing)
- **CONTRIBUTING.md** - Added contribution guidelines with setup instructions
- **README badges** - Added live badges for npm version, build status, Bun version, and license

### Changed

- **README overhaul** - Streamlined and reorganized
  - Fixed incorrect install command (`bun install` → `npm install -g @spenceriam/impulse`)
  - Fixed requirements (Bun is required, not Node.js)
  - Added CLI Options section
  - Added Acknowledgements section
  - Added GIF placeholder for future demo
  - Removed ASCII mockups (will be replaced with GIF)

- **Docs cleanup** - Archived outdated planning docs to `docs/archive/`

### Fixed

- **StartOverlay footer layout** - Fixed overlap on small terminals
  - Increased footer height from 3 to 4 rows

## [0.16.1] - 2026-01-23

### Fixed

- **Update Notification Wrong Version** - Fixed update checker showing wrong version
  - Was hardcoded to `0.15.2`, now reads from `package.json`

- **`--version` Output** - Simplified to just print version number (e.g., `0.16.0`)
  - Previously printed `IMPULSE v0.16.0`

- **Paste Indicator** - Fixed paste handling to match OpenCode behavior
  - Shows `[Pasted ~{N} lines]` only for large pastes (>= 3 lines OR > 150 chars)
  - Small pastes no longer show indicator

### Added

- **Image Paste Support** - Added indicator for pasted images
  - Shows `[Pasted image pasted_image_MM-DD-YYYY_HHMM]`
  - Handles duplicate timestamps with `-1`, `-2`, etc. suffix

- **Auto-Update** - Updates now install automatically when detected
  - Shows "Updating to X.X.X..." while installing
  - Shows "Updated! Please restart IMPULSE to apply." on success
  - Shows "Update failed. Run: npm i -g @spenceriam/impulse" on failure
  - Notification anchored at bottom of chat (above prompt)
  - Click `[X]` to dismiss

## [0.16.0] - 2026-01-23

### Added

- **Headless Mode** (`-p, --prompt`): Run prompts directly from command line without TUI
  - Output streams to stdout, useful for piping and scripting
  - Example: `impulse -p "explain this code" < file.ts`
  - Exits after response completes

- **Session Continuation Flags**:
  - `-c, --continue`: Show session picker to resume a previous session
  - `-s, --session <id>`: Resume specific session by ID directly

- **Configuration Flags**:
  - `-m, --model <name>`: Override default model (e.g., `glm-4.7-flash`)
  - `--mode <mode>`: Start in specific mode (`auto`/`agent`/`planner`/`debug`)
  - `-d, --dir <path>`: Set working directory before starting
  - `--verbose`: Enable debug logging (for troubleshooting)

- **Enhanced Exit Summary**:
  - Shows session ID after session ends
  - Displays continuation hints: `impulse -s <session_id>` or `impulse -c`
  - Makes it easy to resume work later

### Changed

- Help text expanded with all new flags and examples
- Session ID now visible in stats for scripting/automation

## [0.15.7] - 2026-01-23

### Added

- **CI/CD Documentation** - Added comprehensive build/release documentation to AGENTS.md

- **CLI Flags** - Added command-line argument handling:
  - `-h, --help`: Print help and exit (works without API key or TTY)
  - `-v, --version`: Print version and exit (works without API key or TTY)
  - `-e, --express`: Start with express mode enabled (existing, now documented)

### Fixed

- **First-Run "Hang" Issue** - Fixed app appearing to hang on first run without API key:
  - `--help` and `--version` now work without requiring API key or entering TUI
  - Added TTY detection - clear error message if stdin/stdout isn't a terminal
  - Added plain-text banner before TUI on first run explaining what's happening
  - Users no longer see a blank/frozen screen when API key prompt isn't obvious
  - This affected ALL platforms, not just specific architectures

### Documentation

- **CI/CD Pipeline Documentation** - Added comprehensive CI/CD section to AGENTS.md:
  - Build matrix with all 6 platform/arch combinations
  - Explanation of cross-compilation for Windows ARM64
  - Release workflow instructions
  - postinstall.mjs behavior documentation
  - Test devices list

## [0.15.6] - 2026-01-23

### Fixed

- **Compiled Binary Tool Loading** - Fixed "file-read.txt not found" error in npm-installed binaries:
  - Tool descriptions were loaded from external `.txt` files using `import.meta.url`
  - `import.meta.url` resolves to `/$bunfs/root/` in compiled binaries, which doesn't contain the `.txt` files
  - Inlined all 9 tool descriptions directly in TypeScript files
  - Removed external `.txt` description files that couldn't be embedded

## [0.15.5] - 2026-01-23

### Fixed

- **Compiled Binary Runtime Error** - Fixed "preload not found @opentui/solid/preload" error:
  - Added `--no-compile-autoload-bunfig` flag to prevent compiled binary from loading bunfig.toml
  - JSX is already transformed during build step, so the preload plugin is not needed at runtime
  - This was preventing the npm-installed binary from running at all

## [0.15.4] - 2026-01-23

### Fixed

- **Binary Execute Permission** - npm-installed binaries now have proper execute permissions:
  - Added `chmod +x` in postinstall script (npm tarballs don't preserve execute bits)
  - Previously binaries installed via `npm i -g @spenceriam/impulse` would fail with "permission denied"

## [0.15.3] - 2026-01-23

### Fixed

- **Binary Execute Permission (CI/CD)** - Added `chmod +x` after building binaries in CI/CD workflow:
  - This alone wasn't enough - npm tarballs strip execute bits during packaging

## [0.15.0] - 2026-01-23

### Changed

- **REBRAND: GLM-CLI → IMPULSE** - Complete project rename:
  - New ASCII logo in welcome screen
  - Package name: `impulse`
  - Binary command: `impulse` (was `glm`)
  - Header prefix: `[IMPULSE]`
  - Config path: `~/.config/impulse/`
  - Project config: `.impulse/` directory
  - Log file: `impulse.log`
  - All UI text, prompts, and documentation updated
  - Tagline: "Powered by Z.ai's Coding Plan - the best cost/engineering ratio for builders"

## [0.14.0] - 2026-01-23

### Added

- **Enhanced Compaction System** - Visual feedback and smart continuation:
  - Shows "Compacting conversation..." with bouncing dots animation
  - Shows "Compact complete" message when done
  - Auto-compact triggers at 85% context usage (was 70%)
  - Status line shows "Compacting soon" warning at 70-84%
  - Progress bar turns yellow in warning zone
  
- **Smart Continuation After Compact**:
  - Auto-compact: Automatically continues with context-aware prompt
  - Manual `/compact`: Shows "What would you like to focus on next?" based on context
  - Includes pending todos in continuation context
  - Natural conversation flow without explicit "continuing" language

### Changed

- **Improved Token Calculation** - More accurate context usage:
  - Includes tool call arguments and results in estimates
  - Uses actual API token counts when available
  - Better estimation for tool-heavy sessions

- **Compact Thresholds**:
  - Warning zone: 70-84% (shows "Compacting soon" in status line)
  - Auto-compact trigger: 85% (was 70%)
  - Provides ~15% headroom for AI responses

## [0.13.9] - 2026-01-23

### Added

- **/start Command** - Welcome screen accessible anytime:
  - Auto-shows on first launch (tracked in config)
  - Shows MCP server list, target users, modes info
  - Creator credit and beta status notice
  - Press any key or click to dismiss

### Fixed

- **Cursor Focus During Overlays** - Input cursor no longer flashes when overlays are shown:
  - Affects /start, /mcp, /model, session picker, and other overlays
  - Cleaner UX without distracting cursor blink

## [0.13.8] - 2026-01-23

### Changed

- **Gutter Redesign** - Replaced DNA helix spinner with color-cycling vertical line:
  - Full-height line on left edge spans entire chat area
  - Cycles through IMPULSE logo colors (cyan, purple, blue, orange, white) at 200ms during processing
  - Dim gray when idle
  - Removed scroll indicator (not needed with hidden scrollbar)

- **ThinkingBlock Icons** - Updated collapse/expand indicators:
  - Collapsed: filled dot (●)
  - Expanded: hollow dot (○)
  - Content scales to actual line count (max 20 rows)
  - No extra blank space in expanded view

- **AI Message Accent Lines** - Now use mode color instead of cyan:
  - AUTO mode: soft white (#cccccc)
  - AGENT mode: cyan (#5cffff)
  - PLANNER mode: purple (#b48eff)
  - User messages remain cyan (primary accent)

### Added

- **Bouncing Dots Animation** - "Thinking · · ·" during AI processing:
  - Shows below model header while waiting for response
  - Three dots bounce in sequence (200ms interval)
  - Mode-colored animation

- **No-Emoji Instruction** - System prompt now explicitly requests no emojis:
  - Terminal interfaces may not render emojis correctly
  - ASCII characters only for indicators

### Fixed

- **/clear and /new Behavior** - No longer returns to welcome screen:
  - Stays on session view after clearing messages
  - Smoother UX without jarring transitions

- **Context Usage Bar** - Now uses actual token counts when available:
  - Falls back to character-based estimate if no token data
  - More accurate progress display

- **ChatView Layout** - Fixed potential overflow issues:
  - Removed redundant width="100%" from container
  - Added overflow="hidden" to inner content box

## [0.13.7] - 2026-01-23

### Fixed

- **Model Picker Checkbox** - `/model` overlay now shows `[x]` checkbox for current model:
  - Added checkbox column before model name
  - Current model shows `[x]` in green, others show `[ ]` dimmed
  - Increased overlay width from 90 to 100 characters

- **Message Accent Lines** - User and AI messages now have thin horizontal accent lines:
  - User messages: cyan (`─`) lines at top and bottom
  - AI messages: mode-colored lines at top and bottom
  - Subtle background colors differentiate message types

- **ThinkingBlock Style** - Removed border, using background color only:
  - Cleaner visual appearance matching brutalist design
  - Dark background (`#0d1a1a`) for collapsed state
  - Proper click-to-expand functionality preserved

- **Streaming Processing Indicator** - AI messages now show "Processing..." during initial streaming:
  - Prevents blank message block when AI is thinking
  - Shows mode-colored indicator until content arrives

## [0.13.6] - 2026-01-23

### Added

- **Comprehensive `/help` Command** - Quick reference guide with scrollable overlay:
  - 2-sentence intro explaining IMPULSE
  - All 5 modes with colors, descriptions, and available tools
  - Status line indicators: (Thinking), [EXPRESS], context bar, MCP dot
  - Keyboard shortcuts reference
  - Common commands in two-column layout
  - Scrollbox support for long content (24 rows max, then scrolls)

### Fixed

- **Dynamic Model Name in InputArea** - Accent bar now shows actual selected model:
  - Added `model` prop to InputArea and BottomPanel
  - Switching models via `/model` updates the display immediately

- **Mode Label Truncation** - `(Thinking)` suffix no longer cut off:
  - Added `flexShrink={0}` to mode label box in accent bar

## [0.13.5] - 2026-01-22

### Fixed

- **Spinner Animation Reactivity** - Spinner now properly starts/stops when loading state changes:
  - Changed from `onMount` to `createEffect` for reactive prop handling
  - Animation starts when `loading=true`, stops when `loading=false`

- **Accent Lines Full Width** - Top and bottom accent lines now span full container width:
  - Used `flexGrow={1}` with `overflow="hidden"` pattern
  - Consistent appearance across different terminal widths

- **Message Background Alignment** - Message blocks now have proper full-width backgrounds:
  - Added `width="100%"` to user and assistant message containers
  - Backgrounds align correctly to the right edge

### Changed

- **Mode Label Position** - Moved from footer to top accent bar:
  - Format: `▄▄▄ AUTO > GLM-4.7 (Thinking) ▄▄▄▄▄▄▄▄▄`
  - Added 1-row spacer below for breathing room
  - Input area no longer feels cramped

- **AUTO Mode Color** - Softened from pure white to soft gray:
  - Changed from `#ffffff` to `#cccccc`
  - Less harsh on the eyes, maintains visibility

- **ThinkingBlock Integration** - MessageBlock now uses ThinkingBlock component:
  - Replaced inline ThinkingSection with proper collapsible component
  - Click to expand/collapse thinking content

- **Gutter Scroll Indicator** - Simplified to visual anchor:
  - Shows dim vertical line (`│`) instead of scroll position
  - OpenTUI scrollbox doesn't expose scroll events
  - Scrollbox handles scrolling internally

## [0.13.4] - 2026-01-22

### Changed

- **Unified Left Gutter Layout** - Major redesign to fix scrollbar instability:
  - Removed right scrollbar from ChatView (was pushing content horizontally)
  - Added left-side gutter column with scroll position indicator
  - Spinner animation moved from BottomPanel to gutter (aligned with input area)
  - Session layout: `[Gutter | Content Column]` structure
  - Gutter shows: `|` for scroll position, `█/░` for thumb, `⣾⣽⣻⢿` spinner during processing

- **InputArea Borderless Design** - Replaced bordered box with color-block styling:
  - Mode-colored accent lines (top: `▄▄▄`, bottom: `▀▀▀`)
  - Dark background (`#252530`) instead of border
  - Footer shows mode and model: `AUTO > GLM-4.7`
  - Consistent styling between welcome screen and session view

- **BottomPanel Simplified** - Removed internal spinner column (now in gutter):
  - Height reduced from 9 to 8 rows (no border overhead)
  - Cleaner 70/30 split for prompt/todos
  - `hasProcessed` prop removed (gutter handles spinner state)

### Technical

- New `Gutter` component (`src/ui/components/Gutter.tsx`) with dual-purpose display
- `GUTTER_WIDTH` (3) and `BOTTOM_PANEL_HEIGHT` (8) exported for layout calculations
- ChatView: `scrollbarOptions: { visible: false }` to hide right scrollbar
- App.tsx session view restructured with `flexDirection="row"` for gutter + content

## [0.13.3] - 2026-01-22

### Changed

- **ThinkingBlock Redesign** - Collapsible thinking section with 2-row preview:
  - Collapsed state (default): 2-row scrollable preview, auto-scrolls to show latest
  - Expanded state: 8-row scrollable view for full content
  - Click header to toggle between states
  - Auto-scroll enabled in collapsed mode during streaming

### Fixed

- **Root Layout Using Explicit Dimensions** - Fixed layout instability at root level:
  - Changed from `width="100%"` to `width={dimensions().width}` (explicit number)
  - Changed from `height="100%"` to `height={dimensions().height}` (explicit number)
  - Follows OpenCode pattern: Yoga layout engine handles explicit values more reliably
  - **This is the root cause fix** - percentage strings caused layout calculation issues

- **ChatView Inner Padding** - Added 2-char padding buffer between content and border:
  - Content no longer pushes directly against border edges
  - Prevents layout instability from content changes affecting borders
  - True containerization: internal changes don't affect external layout

- **BottomPanel Height Calculation** - Fixed InputArea border misalignment:
  - Previous: PANEL_HEIGHT=7 but InputArea needed 9 rows (5 content + 2 padding + 2 border)
  - Now: PANEL_HEIGHT calculated from constants (TEXTAREA_HEIGHT + BORDER_HEIGHT + PADDING_HEIGHT)
  - Border now aligns correctly with content area

## [0.13.2] - 2026-01-22

### Changed

- **MCP Status Indicator Colors** - Simplified indicator logic for clarity:
  - Green = all servers connected successfully
  - Red = any server failures (even if some connected)
  - Yellow = still initializing (no results yet)
  - Previously yellow hid partial failures, now failures are always visible

- **MCP Error Display Width** - Increased error message width from 35 to 60 chars in `/mcp` command output for better readability

### Fixed

- **MCP SSE Response Parsing** - Fixed Z.AI MCP servers failing to connect:
  - Z.AI servers return Server-Sent Events (SSE) format, not plain JSON
  - Added `parseSSEOrJSON()` helper to handle both SSE and JSON responses
  - Health check and tool calls now correctly parse SSE `data:` lines
  - All 5 MCP servers now connect successfully (was 0/5 before fix)

- **UI Layout Stability** - Fixed text overflow breaking UI frame/borders:
  - Added `overflow="hidden"` to ChatView, MessageBlock, and InputArea containers
  - Added `minWidth={0}` to all flex children (critical for shrinking below content size)
  - InputArea prompt indicator now in fixed-width box, textarea in flex container
  - Follows OpenCode patterns: `min-w-0`, `overflow-hidden`, `word-break`
  - Prevents long text from pushing borders and breaking layout

- **ChatView Scrollbar Alignment** - Fixed scrollbar pushing content right:
  - Added explicit `width="100%"` to scrollbox container
  - Removed redundant `width="100%"` from inner content box

- **BottomPanel Layout Stability** - Fixed layout shift when spinner toggles:
  - Spinner container now always reserves space (fixed width=3)
  - Empty placeholder box rendered when no processing has occurred
  - Added `minWidth={0}` and `overflow="hidden"` to all flex containers

- **Streaming Performance** - Fixed delayed text rendering during AI response:
  - Batch scheduler now fires after window from FIRST call, not resetting on each call
  - Previously each stream chunk reset the 16ms timer, causing artificial delay
  - Now properly batches all updates within 16ms window for smooth ~60fps rendering

## [0.13.1] - 2026-01-22

### Changed

- **Lazy Session Creation** - Sessions are no longer created until first user message:
  - Prevents empty sessions from cluttering storage
  - Session created via `ensureSessionCreated()` when user sends first message
  - Empty sessions deleted on exit instead of being saved

- **Event-Driven Auto-Save** - Removed 30-second interval-based auto-save:
  - Sessions now save after each complete AI response via `saveAfterResponse()`
  - Saves on clean exit (`/quit`, `/exit`) via `saveOnExit()`
  - More efficient and predictable save behavior

### Added

- **Ctrl+C Unsaved Changes Warning** - Shows warning when exiting with unsaved changes:
  - First Ctrl+C shows "Exit without saving? Ctrl+C again to confirm"
  - Second Ctrl+C exits without saving
  - Warning only shown when `isDirty()` is true

- **Session Context API** - New methods for session management:
  - `ensureSessionCreated()`: Lazy session creation, returns session ID
  - `saveAfterResponse()`: Save after AI response completes
  - `saveOnExit()`: Save on clean exit
  - `isDirty`: Signal indicating unsaved changes

### Fixed

- **Double Overlay Bug** - Fixed `/load` and `/model` commands showing both command autocomplete and picker overlay:
  - Autocomplete now cleared before showing session/model picker
  - Also clears autocomplete before showing command result overlays

- **Welcome Screen Responsive Width** - Logo frame now adapts to terminal width:
  - Uses `useTerminalDimensions()` for reactive width calculation
  - Clamps between minimum (logo + padding) and ideal (78 chars)
  - Leaves 4-char margin on each side for padding
  - Prevents `[[━━━━]]` overflow on narrow terminals

- **MCP Server URLs** - Fixed Z.AI MCP endpoint URLs to use correct format:
  - Changed from `https://api.z.ai/mcp/<name>` to `https://api.z.ai/api/mcp/<name>/mcp`
  - web-search: `https://api.z.ai/api/mcp/web_search_prime/mcp` (note: `web_search_prime`)
  - web-reader: `https://api.z.ai/api/mcp/web_reader/mcp`
  - zread: `https://api.z.ai/api/mcp/zread/mcp`
  - This was preventing MCP tool calls from succeeding

- **MCP Health Check** - Made health check stricter to catch invalid endpoints:
  - Now properly fails on 404 (wrong URL) instead of marking as "connected"
  - Validates response is valid JSON-RPC format
  - Previously only caught 401/403 auth errors, letting 404s pass silently

- **MCP Accept Header** - Added `Accept: application/json, text/event-stream` header:
  - Required by MCP servers that use streamable HTTP transport
  - Fixes HTTP 406 (Not Acceptable) errors
  - Applied to both health checks and tool calls

## [0.13.0] - 2026-01-22

### Added

- **MCP Tool Execution** - MCP tools now actually execute when called by the AI:
  - Added `callTool()` method to MCPManager for JSON-RPC 2.0 tool calls
  - Supports both HTTP servers (web-search, web-reader, zread, context7) and stdio servers (vision)
  - Created `src/mcp/tools.ts` to bridge MCP tools to the Tool registry
  - MCP tools automatically registered on app startup
  - Tool definitions (15 tools across 5 servers) now included in API calls

### Fixed

- **MCP Integration Gap** - Previously, MCP tools were discovered but never executed:
  - AI could see MCP tools in its tool list
  - Tool calls would fail silently with "Tool not found"
  - Now properly routes to MCP servers via JSON-RPC protocol

## [0.12.0] - 2026-01-22

### Added

- **Project-Based Session Storage** - Sessions are now organized by working directory:
  - Sessions stored in `~/.config/impulse/storage/session/<projectID>/`
  - Project ID is SHA-1 hash of the working directory path
  - `/load` only shows sessions for the current project
  - Matches OpenCode's session organization pattern

- **Fixed-Height Session Picker** - `/load` overlay now has a scrollable list:
  - Maximum 10 visible rows with scrollbar for longer lists
  - Prevents UI overflow with many sessions
  - Shows session count for current project
  - Border around list matches scrollbar alignment fix pattern

### Changed

- **Session Schema** - Added `projectID` and `directory` fields to Session interface:
  - `projectID`: SHA-1 hash for storage organization
  - `directory`: Human-readable path for display
  - Removed redundant `metadata.directory` field

## [0.11.5] - 2026-01-22

### Fixed

- **ChatView Scrollbar Alignment** - Scrollbar no longer misaligns during chat:
  - Separated border from scrollbox (border on outer box, scrollbox inside)
  - Uses `style={{scrollbarOptions: ...}}` pattern per OpenTUI best practices
  - Follows same pattern as TodoPanel for consistency
  - Cleaner layout prevents border/scrollbar conflicts

## [0.11.4] - 2026-01-22

### Fixed

- **Welcome Screen Command Autocomplete** - `/` now shows command list on welcome screen:
  - Added `onAutocompleteChange` prop to WelcomeScreen component
  - Passes autocomplete callback to InputArea for command suggestions
  - Command dropdown now appears identically on both welcome and session screens

## [0.11.3] - 2026-01-22

### Fixed

- **Session List Bug** - `/load` command now correctly lists saved sessions:
  - Fixed key indexing in `SessionStoreInstance.list()` - was using `key[0]` ("session") instead of `key[1]` (session ID)
  - Sessions are now properly retrieved from `~/.config/impulse/storage/session/`

## [0.11.2] - 2026-01-22

### Added

- **Exit Code Display** - Bash tool expanded view shows exit code for failed commands:
  - Shows "Exit code: N" in red for non-zero exits
  - Only displayed when command fails (exit code != 0)

- **File Creation Indicator** - File write tool now shows when files are created:
  - Shows "(created)" suffix for newly created files
  - Distinguishes new files from overwrites

## [0.11.1] - 2026-01-22

### Fixed

- **Tool Display Implementation** - Completed missing helper functions:
  - Added `getToolTitle()` function for generating tool titles from metadata
  - Added `getExpandedContent()` function for bash output, diffs, task actions
  - Added imports for CollapsibleToolBlock and DiffView components
  - Added imports for all type guard functions from tool-metadata
  - Removed unused variables from ToolCallDisplay

- **Type Safety** - Improved TypeScript compliance:
  - Replaced `as any` type assertion with proper typed displayProps object
  - Added consolidated TypeGuards object for cleaner imports
  - Updated DiffView comment documentation

## [0.11.0] - 2026-01-22

### Added

- **Collapsible Tool Blocks** - Tool calls now expand/collapse on click:
  - Collapsed: Shows tool name and summary info
  - Expanded: Shows full tool output/results
  - Click to toggle, improves readability for long outputs
  - Status indicators: ✓ (success), ✗ (error), ~ (running), · (pending)

- **Unified Diff View** - File edit tool now shows proper diffs:
  - Added lines colored green (+), removed lines colored red (-)
  - Diff summary in collapsed view: `(+N/-M)`
  - Truncates very long diffs with indicator
  - Easy visual scan of changes

- **Tool-Specific Metadata** - All tools now return structured metadata:
  - Bash: Command, exit code, output preview, truncation indicators
  - File Write: Line count, file size
  - File Edit: Unified diff, +/- counts
  - File Read: Line count, truncation status
  - Glob: Match count, pattern
  - Grep: Match count, pattern, path

- **Error Auto-Expansion** - Failed tool calls auto-expand on error:
  - Shows red ✗ indicator for errors
  - Error messages immediately visible
  - Reduced clicking to see what went wrong

- **Looper Visibility** - Consecutive tool failures show attempt counter:
  - Displays "(attempt N)" when same tool fails repeatedly
  - Helps visualize retry loops and debugging
  - Yellow warning color for visibility

- **Output Truncation Safety** - Prevents UI crashes from massive output:
  - Bash output limited to 50 lines or 5000 characters
  - Shows "... (N more lines)" or "... (output truncated)" indicators
  - Protects against runaway command output

### Changed

- **Tool Display** - Completely refactored from subtext to collapsible blocks:
  - More information available without expanding
  - Better visual hierarchy
  - Cleaner, more organized appearance

## [0.10.2] - 2026-01-22

### Fixed

- **Layout Stability** - Bottom panel now locked and cannot be pushed down by chat content:
  - Added `flexShrink={0}` to header and bottom section (OpenCode pattern)
  - Simplified ChatView: scrollbox is now direct child with `flexGrow={1}`
  - Chat content scrolls within fixed boundaries, never overflows into prompt area

## [0.10.1] - 2026-01-22

### Added

- **Prompt History Navigation** - Use Up/Down arrows to browse previous prompts:
  - Up arrow recalls previous prompt (when cursor at start or empty)
  - Down arrow navigates forward or returns to current input
  - Saves current input when navigating, restores when returning
  - Maximum 50 history entries

- **Double-ESC Clear** - Press Escape twice (within 500ms) to clear prompt box

### Changed

- **Subagent Model Upgrade** - Switched from `glm-4.5-flash` to `glm-4.7-flash`:
  - Better reasoning and tool use for subagent tasks
  - Maintains fast response times

- **Ghost Text Styling** - Placeholder text is now darker and italic:
  - Color changed from dim gray to `#444444`
  - Italic style for subtle, non-intrusive appearance

## [0.10.0] - 2026-01-22

### Added

- **Real Subagent Execution** - Task tool now spawns actual subagent conversations:
  - `explore` subagent: Read-only codebase search (file_read, glob, grep)
  - `general` subagent: Multi-purpose agent (can modify files, run bash)
  - Subagents run in batch mode using glm-4.7-flash for speed
  - Action summaries shown in tool call display

- **Bottom Panel Layout** - New 70/30 split design:
  - Fixed-height prompt area (5 rows) - chat cannot push into it
  - Todo panel integrated into bottom 30% when todos exist
  - Prompt expands to 100% when no todos
  - Bordered todo panel with scrollbox support

- **TodoPanel Component** - Dedicated todo display:
  - In-progress tasks sorted to top
  - Completed tasks show strikethrough
  - Scrollable when items exceed visible area

### Changed

- **Tool Call Display** - New subtext style for less visual noise:
  - Success: Dim `↳` prefix, no status shown (silence is golden)
  - Error: Red `✗` prefix with error message
  - Task tools show `[explore]` or `[general]` type with nested action summaries

- **Spinner Behavior** - Static idle state after processing:
  - Shows dimmed `⣷` (last frame) when AI has completed
  - Blank before first interaction

### Removed

- **Sidebar** - Replaced with integrated bottom panel todo display
- **CollapsedSidebar** - No longer needed with new layout

## [0.9.12] - 2026-01-21

### Performance

- **60fps Streaming** - Batch stream updates at 16ms intervals for smooth rendering:
  - Content, reasoning, and tool call updates are now batched
  - Eliminates UI jank during AI response streaming
  - Flushes pending updates when stream completes

### Fixed

- **Cursor Color** - Input cursor now matches the cyan accent color (`#5cffff`):
  - Added `cursorColor` prop to textarea component
  - Consistent with overall color scheme

## [0.9.11] - 2026-01-21

### Fixed

- **Chat Container Expanding** - Fixed chat overflowing into prompt box:
  - Added `overflow="hidden"` to layout containers
  - Chat now respects boundaries and scrolls internally

- **Sidebar Default State** - Now collapsed by default (Ctrl+B to expand):
  - Cleaner initial view focused on chat
  - Sidebar expands when needed

### Changed

- **Thinking Section** - Now shows italic "Thinking" label:
  - Dim left border (`┊`) with italic text
  - Lighter background (`#1f1f1f`) to distinguish from content
  - Max 2 lines, truncated with "..."

- **AI Response Formatting** - Improved markdown rendering:
  - Better code block handling with margins
  - Inline `code` and **bold** formatting
  - Numbered lists (1. 2. 3.) support
  - Headings support (# ## ###)
  - Proper blank line handling

- **Message Backgrounds** - Visual distinction between message types:
  - User messages: Dark cyan (`#1a2a2a`) with cyan left border
  - AI responses: Dark gray (`#141414`) background
  - Thinking: Lighter gray (`#1f1f1f`) background

- **Spacing** - Tighter, cleaner layout:
  - Reduced message margins (2 → 1)
  - Compact tool call display (single line)
  - Removed extra padding between elements

- **Todos Section** - Now hidden unless there are active todos:
  - Cleaner sidebar when no tasks
  - Only appears when AI creates todos

## [0.9.10] - 2026-01-21

### Fixed

- **Chat Container Overflow** - Fixed scrollbox overflow and lines spilling into sidebar:
  - Added `overflow="hidden"` to outer box
  - Set explicit `width="100%"` on scrollbox
  - Wrapped message list in flex column container

- **Input Box Background** - Added dark purple background (`#1a1a2a`) per design spec:
  - Fixed-height input with internal scrolling (3 rows min)
  - Matches design mockup color scheme

### Changed

- **User Message Styling** - Added visual distinction for user messages:
  - Dark cyan background (`#1a2a2a`) for user message container
  - Cyan left border (`┃`) for visual emphasis
  - Clear separation between user and assistant messages

- **Thinking Section** - Simplified to compact 2-line preview:
  - Replaced collapsible expand/collapse with inline display
  - Max 150 chars or 2 lines, truncated with "..."
  - Dim left border (`┊`) instead of heavy box
  - Removes visual noise while preserving context

- **Exit Summary** - Enhanced with full session statistics:
  - Tool calls: total, success, failed, and breakdown by tool name
  - Token usage: input, output, thinking, cache read/write, total
  - Better formatting with aligned columns

### Added

- **Token Tracking** - Session context now tracks token usage per API call:
  - New `TokenStats` type: input, output, thinking, cacheRead, cacheWrite
  - New `ToolStats` type: total, success, failed, byName
  - `addTokenUsage()` and `recordToolCall()` methods on session context

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
  - **Allow always**: Persisted to `.impulse/permissions.json`, applies to all future sessions

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

- **Welcome Screen** - Centered IMPULSE logo properly:
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
  - Gradient colors matching IMPULSE logo (cyan to dim)
  - Staggered/randomized timing for organic feel
  - Positioned to the left of input box, matching its height
  - Input disabled while loading

## [0.8.0] - 2026-01-21

### Added

- **Session Header** - Dynamic header line at top of session screen:
  - Format: `[IMPULSE] | <context>`
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
  - Enable with `impulse --express` or `-e` flag
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

- **Collapsible Sidebar** - Sidebar can now be toggled with `Ctrl+B`; when collapsed, shows a 1-char strip with vertical "IMPULSE" branding
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

- **Logo Centering** - IMPULSE ASCII logo now properly centered in welcome screen border frame using flexbox

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
