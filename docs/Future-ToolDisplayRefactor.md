# Tool Display Refactor

> Enhanced tool call display with collapsible blocks, unified diffs, and looper visibility

**Created**: 2026-01-22
**Status**: Planned Enhancement (Outside Original MVP Scope)
**Baseline Version**: v0.10.2
**Estimated Effort**: ~7 hours

---

## Summary

This feature enhances how tool calls (bash, file operations, search, subagents) are displayed in the impulse chat interface. The current implementation shows minimal information; this refactor adds:

- **Collapsible tool blocks** - Click to expand/collapse
- **Status indicators** - ✓ (success), ✗ (error), ~ (running), · (pending)
- **Unified diff view** - See file changes with +/- colored lines
- **Output previews** - First 3 lines of bash output
- **Looper visibility** - Attempt counter for retries

---

## Quick Reference

### Visual Example (Before → After)

**Before:**
```
↳ bash echo "hello"
↳ file_write src/foo.ts
↳ file_edit src/bar.ts
```

**After:**
```
▶ ✓ bash "echo hello"
  ✓ file_write src/foo.ts (12 lines)
▶ ✓ file_edit src/bar.ts (+5/-2)
▼ ✗ bash "npm test" (exit 1)
    $ npm test
    FAIL: Tests failed
```

---

## Documentation

| Document | Purpose |
|----------|---------|
| [feature-tool-display/Requirements.md](feature-tool-display/Requirements.md) | Functional and non-functional requirements |
| [feature-tool-display/Design.md](feature-tool-display/Design.md) | Architecture and component design |
| [feature-tool-display/Tasks.md](feature-tool-display/Tasks.md) | BMAD-method implementation tasks with before/after code |
| [feature-tool-display/Visual-Spec.md](feature-tool-display/Visual-Spec.md) | Comprehensive ASCII mockups for all states |

---

## Design Philosophy

Inspired by Geoffrey Huntley's looping patterns (https://ghuntley.com/ralph/, https://ghuntley.com/loop/):

> "It's important to *watch the loop* as that is where your personal development and learning will come from. When you see a failure domain – put on your engineering hat and resolve the problem so it never happens again."

Integrates with existing **looper skill** (`.opencode/skills/looper/SKILL.md`).

---

## User Preferences (Locked In)

| Feature | Decision |
|---------|----------|
| Bash output | Show first 3 lines by default |
| File edits | Unified diff (simple +/- markers) |
| File writes | Filename + line count only |
| Default state | Collapsed (click to expand) |
| Success indicator | Dim checkmark (✓) |
| Error indicator | Red X (✗) + auto-expand |

---

## Implementation Phases

| Phase | Name | Tasks | Effort |
|-------|------|-------|--------|
| 1 | Data Infrastructure | 9 | ~2.5 hours |
| 2 | UI Components | 6 | ~3 hours |
| 3 | Polish & Looper | 4 | ~1.5 hours |

See [Tasks.md](feature-tool-display/Tasks.md) for detailed implementation steps.

---

## Context Recovery

If resuming work after compaction:

1. Read [Tasks.md](feature-tool-display/Tasks.md) for current state
2. Check `git log` to see which tasks were completed
3. Check `git status` for work in progress
4. Run `bun run build` to verify current state compiles

### Key Files
- `src/types/tool-metadata.ts` - Type definitions
- `src/ui/components/MessageBlock.tsx` - Main display logic
- `src/ui/components/CollapsibleToolBlock.tsx` - Collapse component
- `src/ui/components/DiffView.tsx` - Diff renderer
- `src/tools/*.ts` - Tool implementations with metadata
