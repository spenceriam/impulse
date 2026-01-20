# PRINCIPLES.md

> Non-negotiable rules for glm-cli development. Violations break user trust.

## UI/UX Principles

### No Emojis
- Zero emojis in UI, logs, messages, or documentation
- Brutalist aesthetic: function over decoration
- Use text symbols where indicators needed (arrows, bullets)

### Flicker-Free Rendering
- 16ms event batching for all streaming updates
- Use `batch()` from solid-js for coalesced state updates
- Use `reconcile()` for efficient deep state updates
- Target 60fps minimum

### Double-Press Safety
- `Esc` requires 2 presses to cancel operation
- `Ctrl+C` requires 2 presses to exit
- Prevents accidental interruption of long-running tasks
- Show "Press again to confirm" on first press

## API Principles

### No Silent Fallbacks
- Never silently switch API endpoints or models
- Always notify user of any fallback action
- Explicit error dialogs with clear options
- User must acknowledge before proceeding

### Auto-Retry Policy
- 5 automatic retries on transient failures
- Show retry count to user: "Retrying (2/5)..."
- Exponential backoff between retries
- After 5 failures, show explicit error dialog

### Single API Endpoint
- Use `https://api.z.ai/api/coding/paas/v4/` exclusively
- No fallback to standard endpoints
- Coding Plan endpoint enables thinking mode

## Git Principles

### No Unauthorized Push
- Never execute `git push` without explicit user permission
- Ask confirmation before any remote operations
- Show what will be pushed before confirming

### Per-Message Checkpoints
- Create git checkpoint after every assistant message
- Enable granular undo/redo per interaction
- Checkpoint includes all file changes in that turn
- Use lightweight tags or stash for checkpoints

### Commit Discipline
- Conventional commits format required
- Commit after each discrete, working change
- Never commit broken code
- Clear, descriptive commit messages

## Session Principles

### Auto-Save
- Save session state every 30 seconds
- Save on any destructive operation
- Save before exit (even on crash if possible)

### Auto-Compact
- Trigger at 70% context window usage
- AI-powered summarization preserves key context
- Never lose critical information
- Show notification when compacting

### Thinking Preservation
- Preserve `reasoning_content` in conversation history
- Thinking mode ON by default for GLM-4.7
- Collapsible display in UI
- Track thinking tokens separately in stats

## Tool Principles

### Explicit Tool Results
- Always show tool execution status
- Collapsible blocks for verbose output
- Never hide errors from user
- Clear success/failure indicators

### File Operation Safety
- Confirm before overwriting existing files
- Show diff preview for edits when practical
- Never delete without confirmation
- Respect .gitignore patterns

## Error Handling Principles

### User-Facing Errors
- Clear, actionable error messages
- No stack traces in UI (log them separately)
- Always provide next steps or options
- Retry / Change Config / Quit pattern

### Graceful Degradation
- MCP server failures don't crash the app
- Missing config prompts for setup
- Network issues trigger retry flow
- Always maintain usable state

## Code Quality Principles

### TypeScript Strict
- `strict: true` in tsconfig
- No `any` types
- Explicit return types on public functions
- Zod for runtime validation at boundaries

### No Magic
- Explicit over implicit
- Clear data flow
- Minimal abstraction layers
- Code should be readable without comments

## Documentation Principles

### Living Documentation
- AGENTS.md is the project brain
- Update docs with code changes
- Decision log for architectural choices
- Date-stamp all generated docs

### Consistency
- Follow established naming conventions
- Match existing patterns in codebase
- Use templates for similar content
- Keep structure predictable
