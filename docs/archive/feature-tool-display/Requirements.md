# Tool Display Refactor - Requirements

> Functional and non-functional requirements for enhanced tool call display

Generated: 01-22-2026
Status: Planned Enhancement (Outside Original MVP Scope)
Baseline Version: v0.10.2

---

## Overview

**Tool Display Refactor** enhances how tool calls (bash, file operations, search, subagents) are displayed in the impulse chat interface. The current implementation shows minimal information; this refactor adds collapsible blocks, unified diffs, output previews, and retry visibility.

### Target Users

- Developers using impulse for agentic coding workflows
- Users who need visibility into what the AI agent is doing
- Developers debugging failed tool executions
- Users following the "Ralph loop" pattern who need to "watch the loop"

### Core Value Proposition

1. **Visibility** - See what tools are doing without overwhelming detail
2. **Collapsible** - Expand only what you need, keep the view clean
3. **Diff View** - Understand file changes at a glance
4. **Retry Awareness** - Watch the loop, tune the agent when patterns fail
5. **Error Highlighting** - Failures auto-expand for immediate attention

### Design Philosophy: Watch the Loop

Inspired by Geoffrey Huntley's looping patterns (https://ghuntley.com/ralph/, https://ghuntley.com/loop/):

> "It's important to *watch the loop* as that is where your personal development and learning will come from. When you see a failure domain – put on your engineering hat and resolve the problem so it never happens again."

This integrates with our existing **looper skill** (`.opencode/skills/looper/SKILL.md`) which defines the retry/persistence pattern. The UI must provide visibility into:
- Which tools failed and why
- Retry attempts (looper engaging)
- Patterns that keep failing (tuning opportunities)

---

## 1. Functional Requirements

### 1.1 Status Indicators

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.1.1 | Display checkmark (✓) for successful tool calls | Must |
| FR-1.1.2 | Display X (✗) for failed tool calls | Must |
| FR-1.1.3 | Display tilde (~) for running tool calls | Must |
| FR-1.1.4 | Display dot (·) for pending tool calls | Should |
| FR-1.1.5 | Success indicator is dim/muted color | Must |
| FR-1.1.6 | Error indicator is red/highlighted | Must |
| FR-1.1.7 | Running indicator is dim/muted color | Must |

### 1.2 Collapse/Expand Behavior

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.2.1 | Tool blocks are collapsed by default | Must |
| FR-1.2.2 | Failed tool blocks auto-expand | Must |
| FR-1.2.3 | Click anywhere on tool line toggles expand/collapse | Must |
| FR-1.2.4 | Show expand indicator (▶/▼) before status | Must |
| FR-1.2.5 | Expanded state persists during session (not across restarts) | Should |
| FR-1.2.6 | Keyboard navigation to expand/collapse (future) | Could |

### 1.3 Bash Tool Display

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.3.1 | Collapsed: Show command description or truncated command | Must |
| FR-1.3.2 | Expanded: Show full command with $ prefix | Must |
| FR-1.3.3 | Expanded: Show first 3 lines of output by default | Must |
| FR-1.3.4 | Show "... (N more lines)" if output exceeds 3 lines | Must |
| FR-1.3.5 | Second click expands to show more output (up to limit) | Should |
| FR-1.3.6 | Hard limit: 50 lines max displayed | Must |
| FR-1.3.7 | Strip ANSI codes from output display | Must |
| FR-1.3.8 | Show exit code for non-zero exits | Must |

### 1.4 File Write Display

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.4.1 | Show filename and line count: "file_write path/file.ts (142 lines)" | Must |
| FR-1.4.2 | Indicate if file was created vs overwritten | Should |
| FR-1.4.3 | No expanded view needed (minimal info sufficient) | Must |

### 1.5 File Edit Display

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.5.1 | Collapsed: Show filename and diff stats: "file_edit path/file.ts (+12/-5)" | Must |
| FR-1.5.2 | Expanded: Show unified diff with +/- markers | Must |
| FR-1.5.3 | Diff lines colored: green for additions, red for deletions | Must |
| FR-1.5.4 | Show context lines around changes (1-2 lines) | Should |
| FR-1.5.5 | Truncate diff if > 30 changed lines | Must |
| FR-1.5.6 | Show "... (N more changes)" if truncated | Should |

### 1.6 File Read Display

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.6.1 | Show filename and lines read: "file_read path/file.ts (150 lines)" | Must |
| FR-1.6.2 | Indicate if content was truncated | Should |
| FR-1.6.3 | No expanded view needed | Must |

### 1.7 Glob/Grep Display

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.7.1 | Show pattern and match count: 'glob "**/*.ts" (47 matches)' | Must |
| FR-1.7.2 | Show search path if specified | Should |
| FR-1.7.3 | No expanded view needed | Must |

### 1.8 Task (Subagent) Display

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.8.1 | Collapsed: Show subagent type and description | Must |
| FR-1.8.2 | Expanded: Show action summaries (tools called) | Must |
| FR-1.8.3 | Show tool call count | Must |
| FR-1.8.4 | Nested indentation for subagent actions | Should |
| FR-1.8.5 | Max 5 actions shown, with "... (N more)" | Should |

### 1.9 Looper Integration (Retry/Attempt Tracking)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.9.1 | Track attempts for repeated tool calls (same task/goal) | Should |
| FR-1.9.2 | Show attempt counter: "(attempt 2/3)" when retrying | Should |
| FR-1.9.3 | Visual indicator when looper pattern engages | Could |
| FR-1.9.4 | Reset attempt counter on success | Should |
| FR-1.9.5 | Integrate with looper skill iteration limits | Could |

**Note:** This provides UI visibility for the looper skill defined in `.opencode/skills/looper/SKILL.md`. The looper skill handles the logic; this feature surfaces it in the UI.

### 1.10 Error Display

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.10.1 | Auto-expand failed tool blocks | Must |
| FR-1.10.2 | Show full error message in expanded view | Must |
| FR-1.10.3 | Red/highlighted styling for errors | Must |
| FR-1.10.4 | Error details preserved for debugging | Should |

---

## 2. Non-Functional Requirements

### 2.1 Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-2.1.1 | Render time for tool block | < 16ms |
| NFR-2.1.2 | No flicker during expand/collapse | 60fps |
| NFR-2.1.3 | Diff generation time | < 100ms for typical files |
| NFR-2.1.4 | Memory for cached metadata | < 10MB per session |

### 2.2 Reliability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-2.2.1 | Graceful handling of missing metadata | Fallback to basic display |
| NFR-2.2.2 | Truncation prevents UI crashes | Hard limits enforced |
| NFR-2.2.3 | Invalid diff gracefully handled | Show "Diff unavailable" |

### 2.3 Usability

| ID | Requirement | Description |
|----|-------------|-------------|
| NFR-2.3.1 | Scannable at a glance | Status + summary visible without expanding |
| NFR-2.3.2 | Brutalist aesthetic | No emojis, minimal decoration, ASCII indicators |
| NFR-2.3.3 | Consistent with existing UI | Match colors, spacing, fonts |
| NFR-2.3.4 | Click targets are clear | Whole line is clickable |

### 2.4 Maintainability

| ID | Requirement | Description |
|----|-------------|-------------|
| NFR-2.4.1 | Tool metadata is typed | TypeScript interfaces for each tool |
| NFR-2.4.2 | Tool displays are modular | One component per tool type |
| NFR-2.4.3 | Easy to add new tools | Follow established pattern |
| NFR-2.4.4 | Diff library is isolated | Can swap implementation later |

---

## 3. Constraints

| ID | Constraint | Rationale |
|----|------------|-----------|
| C-1 | Must work with existing ToolCallInfo structure | Backwards compatibility |
| C-2 | No breaking changes to tool implementations | Gradual migration |
| C-3 | Metadata is optional | Tools without metadata still display |
| C-4 | Use `diff` npm package | Same as OpenCode, proven solution |
| C-5 | No syntax highlighting in diffs | Keep simple, add later if needed |

---

## 4. Assumptions

| ID | Assumption |
|----|------------|
| A-1 | Tools can be modified to return structured metadata |
| A-2 | File content is available at edit time for diff generation |
| A-3 | Output can be safely truncated without losing critical info |
| A-4 | Users prefer collapsed view to reduce visual noise |
| A-5 | Click interaction is sufficient (no keyboard shortcuts initially) |

---

## 5. Out of Scope

| Item | Rationale |
|------|-----------|
| Syntax highlighting in diffs | Complexity, add in future iteration |
| Side-by-side diff view | Requires wide terminal, unified is sufficient |
| Tool output search | Not needed for MVP of this feature |
| Persistent expand/collapse state | Session-only is sufficient |
| Full output download | Can copy from terminal if needed |
| Real-time output streaming | Tool output arrives complete |

---

## 6. Open Questions

| ID | Question | Status | Decision |
|----|----------|--------|----------|
| OQ-1 | Should we cache diffs or regenerate on expand? | Decided | Cache in metadata |
| OQ-2 | Should second expand show full output or scroll? | Decided | Show more with scroll |
| OQ-3 | Should attempt tracking be per-command or per-task? | Decided | Per-task (same goal) |
| OQ-4 | Should we show timestamps on tool calls? | Open | - |
| OQ-5 | Should we support filtering tool types? | Deferred | Future enhancement |

---

## 7. User Preferences (Locked In)

These were decided through user interview:

| Feature | Decision | Rationale |
|---------|----------|-----------|
| Bash default lines | 3 lines | Quick preview without overwhelming |
| Diff style | Unified (+/-) | Simple, familiar, sufficient |
| File write detail | Filename + count | Minimal info is enough |
| Default state | Collapsed | Clean view, expand on demand |
| Success indicator | Checkmark + dim | Subtle, not distracting |
| Error indicator | X + red + expand | Immediate visibility |

---

## 8. Related Documents

| Document | Purpose |
|----------|---------|
| [Design.md](Design.md) | Architecture and component design |
| [Tasks.md](Tasks.md) | Implementation tasks (BMAD-method) |
| [../../AGENTS.md](../../AGENTS.md) | Project brain with decision log |
