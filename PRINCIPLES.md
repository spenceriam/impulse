# PRINCIPLES.md

> Non-negotiable rules for IMPULSE development. Violations break user trust.

## UI/UX Principles

### No Emojis
- Zero emojis in UI, logs, messages, or documentation
- Brutalist aesthetic: function over decoration
- Use text symbols where indicators needed (arrows, bullets)

### Flicker-Free Rendering
- Batch streaming updates to avoid terminal flicker
- Target smooth redraws during tool execution and token streaming
- pi-tui components re-render on terminal resize without pixel scaling

### Double-Press Safety
- `Esc` requires 2 presses to cancel operation
- `Ctrl+C` requires 2 presses to exit
- Prevents accidental interruption of long-running tasks
- Show "Press again to confirm" on first press

## API Principles

### No Silent Fallbacks
- Never silently switch providers, models, or endpoints
- Always notify user of any fallback action
- Explicit error dialogs with clear options
- User must acknowledge before proceeding

### Auto-Retry Policy
- 5 automatic retries on transient failures
- Show retry count to user: "Retrying (2/5)..."
- Exponential backoff between retries
- After 5 failures, show explicit error dialog

### Multi-Provider Architecture
- Provider selection is explicit via config and `/model`
- Each provider implements the shared `Provider` interface in `src/api/providers/`
- Z.ai remains a supported provider (Coding Plan endpoint) but is not the only path
- No silent fallback between providers

## Git Principles

### No Unauthorized Push
- Never execute `git push` without explicit user permission
- Ask confirmation before any remote operations
- Show what will be pushed before confirming

### Per-Message Checkpoints
- Git checkpoint created before each user message
- Enables `/undo` to revert to prior state
- Checkpoint branches use `impulse-checkpoint-*` prefix (legacy `glm-checkpoint-*` still readable)

## Permission Principles

### Explicit Approval
- Destructive tools require user approval unless express mode is on
- Permission prompts show tool name, target path/command, and scope options
- Rejection messages guide the agent with `[USER DECISION]` prefix

### Express Mode Safety
- Express mode auto-approves tool permissions for the session only
- First enable shows a warning; user must acknowledge
- Never persisted across sessions by default

## Session Principles

### Session Integrity
- All messages persisted through `SessionManager`
- Tool results stored with matching `tool_call_id`
- Reasoning content preserved in assistant messages for providers that support it

### Context Management
- Auto-compact at 60% context fill
- Manual `/compact` available
- Context usage shown in footer context bar

## Code Principles

### TypeScript Strict
- No `any` types
- Zod for runtime validation at tool and command boundaries
- Branded tool schemas in `src/tools/schemas/`

### Tool Input Repair
- Use `validateToolInput()` from `src/tools/input-repair/` before Zod parse
- Do not use legacy `stripNullValues()` — removed in favor of the repair layer

### Minimal Scope
- Smallest correct diff
- Match existing conventions in surrounding code
- No drive-by refactors
