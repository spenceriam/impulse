# Tool Display Refactor Plan

> **Purpose**: This document captures the complete plan for refactoring tool call display in glm-cli. It serves as context preservation across sessions and compaction.

**Created**: 2026-01-22
**Status**: Planned Enhancement (Outside Original MVP Scope)
**Baseline Version**: v0.10.2

> **Note**: This feature was **not part of the original project planning** (Requirements.md, Design.md, Tasks.md). It was identified during development as a valuable enhancement for agentic coding visibility. Can be implemented when ready.

---

## Design Decisions (Locked In)

### User Preferences
| Feature | Decision |
|---------|----------|
| Bash output | Show first 3 lines by default |
| File edits | Unified diff (simple +/- markers) |
| File writes | Filename + line count only |
| Default state | Collapsed (click to expand) |
| Success indicator | Dim checkmark (✓) + color |
| Error indicator | Red X (✗) + auto-expand |
| Running indicator | Dim tilde (~) |

### Status Display Format
```
✓ bash "install deps"                    <- Success: dim, collapsed
✗ bash "npm test" (exit 1)               <- Error: red, auto-expanded
~ bash "building..."                     <- Running: dim tilde
```

### Expanded View Format
```
▼ bash "install deps"                    ✓
  $ npm install zod openai
  added 42 packages in 2.3s
  ... (click to collapse)

▼ file_edit src/ui/App.tsx (+12/-5)      ✓
  @@ -45,7 +45,12 @@
  - const [loading, setLoading] = useState(false);
  + const [loading, setLoading] = useState(false);
  + const [error, setError] = useState<string | null>(null);
```

### Attempt Tracking
- Track at task level (same goal, different approaches)
- Show attempt counter when retrying: `(attempt 2/3)`
- Integrate with looper skill for visibility

---

## Architecture Overview

### Current State
```
ToolCallInfo {
  id: string
  name: string
  arguments: string        <- Raw JSON string
  status: "pending" | "running" | "success" | "error"
  result?: string          <- Raw result string
}
```

### Target State
```
ToolCallInfo {
  id: string
  name: string
  arguments: string
  status: "pending" | "running" | "success" | "error"
  result?: string
  metadata?: ToolMetadata  <- NEW: Structured data per tool type
}

ToolMetadata = 
  | BashMetadata
  | FileWriteMetadata
  | FileEditMetadata
  | FileReadMetadata
  | GlobMetadata
  | GrepMetadata
  | TaskMetadata

BashMetadata {
  command: string
  description?: string
  output: string
  exitCode: number
  truncated: boolean       // True if output was cut off
}

FileWriteMetadata {
  filePath: string
  linesWritten: number
  created: boolean         // True if new file
}

FileEditMetadata {
  filePath: string
  diff: string             // Unified diff format
  linesAdded: number
  linesRemoved: number
}

FileReadMetadata {
  filePath: string
  linesRead: number
  truncated: boolean
}

GlobMetadata {
  pattern: string
  path?: string
  matchCount: number
}

GrepMetadata {
  pattern: string
  path?: string
  matchCount: number
}

TaskMetadata {
  subagentType: string
  description: string
  actions: string[]        // Summary of actions taken
  toolCallCount: number
}
```

---

## Implementation Phases

### Phase 1: Data Infrastructure (CURRENT)

#### Chunk 1.1: ToolCallInfo Interface Update
**File**: `src/ui/components/MessageBlock.tsx`
**Changes**:
- Add `metadata?: ToolMetadata` to `ToolCallInfo`
- Define all metadata type interfaces
- Export types for use in tools

**Estimated time**: 15 minutes

#### Chunk 1.2: Bash Tool Metadata
**File**: `src/tools/bash.ts`
**Changes**:
- Capture stdout/stderr separately
- Parse exit code
- Truncate output if > 50 lines (store full in result, truncated in metadata)
- Return structured `BashMetadata`

**Estimated time**: 30 minutes

#### Chunk 1.3: File Write Tool Metadata
**File**: `src/tools/file-write.ts`
**Changes**:
- Count lines written
- Detect if file was created vs overwritten
- Return structured `FileWriteMetadata`

**Estimated time**: 15 minutes

#### Chunk 1.4: File Edit Tool Metadata
**File**: `src/tools/file-edit.ts`
**Changes**:
- Install `diff` package: `bun add diff`
- Capture old content before edit
- Generate unified diff after edit
- Count lines added/removed
- Return structured `FileEditMetadata`

**Estimated time**: 30 minutes

#### Chunk 1.5: File Read Tool Metadata
**File**: `src/tools/file-read.ts`
**Changes**:
- Count lines read
- Track if content was truncated
- Return structured `FileReadMetadata`

**Estimated time**: 15 minutes

#### Chunk 1.6: Glob/Grep Tool Metadata
**Files**: `src/tools/glob.ts`, `src/tools/grep.ts`
**Changes**:
- Return match count in metadata

**Estimated time**: 15 minutes

#### Chunk 1.7: Task Tool Metadata Enhancement
**File**: `src/tools/task.ts`
**Changes**:
- Parse actions from subagent result
- Count tool calls made
- Return structured `TaskMetadata`

**Estimated time**: 15 minutes

**Phase 1 Total**: ~2 hours

---

### Phase 2: UI Components

#### Chunk 2.1: Status Indicators
**File**: `src/ui/components/MessageBlock.tsx`
**Changes**:
- Update `getToolStatusDisplay()` function
- Add checkmark (✓) for success
- Add X (✗) for error
- Add tilde (~) for running
- Color coding: dim for success, red for error

**Mockup**:
```tsx
function getToolStatusDisplay(status) {
  switch (status) {
    case "success":
      return { prefix: "✓", color: Colors.ui.dim, expanded: false };
    case "error":
      return { prefix: "✗", color: Colors.status.error, expanded: true };
    case "running":
      return { prefix: "~", color: Colors.ui.dim, expanded: false };
    case "pending":
      return { prefix: "·", color: Colors.ui.dim, expanded: false };
  }
}
```

**Estimated time**: 20 minutes

#### Chunk 2.2: Collapsible Tool Block Component
**File**: `src/ui/components/ToolBlock.tsx` (NEW)
**Changes**:
- Create reusable collapsible block
- Track expanded state with signal
- Click handler to toggle
- Props: `title`, `status`, `children`, `defaultExpanded`

**Mockup**:
```tsx
function CollapsibleToolBlock(props) {
  const [expanded, setExpanded] = createSignal(props.defaultExpanded ?? false);
  const indicator = () => expanded() ? "▼" : "▶";
  
  return (
    <box flexDirection="column" paddingLeft={2}>
      <box 
        flexDirection="row" 
        onMouseUp={() => setExpanded(e => !e)}
      >
        <text fg={Colors.ui.dim}>{indicator()} </text>
        <text fg={props.statusColor}>{props.statusPrefix} </text>
        <text fg={props.statusColor}>{props.title}</text>
      </box>
      <Show when={expanded()}>
        <box paddingLeft={4}>
          {props.children}
        </box>
      </Show>
    </box>
  );
}
```

**Estimated time**: 30 minutes

#### Chunk 2.3: Bash Tool Display
**File**: `src/ui/components/MessageBlock.tsx` or new file
**Changes**:
- Show command on collapsed line
- Show first 3 lines of output when expanded
- "Show more..." link if output > 3 lines
- Full output on second expansion

**Mockup**:
```
▶ ✓ bash "install dependencies"

▼ ✓ bash "install dependencies"
    $ npm install zod openai
    added 42 packages in 2.3s
    (3 more lines...)
```

**Estimated time**: 30 minutes

#### Chunk 2.4: File Write Display
**File**: `src/ui/components/MessageBlock.tsx`
**Changes**:
- Show filename + line count on collapsed
- No expanded view needed (per user preference)

**Mockup**:
```
✓ file_write src/api/client.ts (142 lines)
```

**Estimated time**: 15 minutes

#### Chunk 2.5: File Edit Display with Diff
**File**: `src/ui/components/MessageBlock.tsx`
**Changes**:
- Show filename + diff stats on collapsed
- Show unified diff when expanded
- Color: green for +, red for -

**Mockup**:
```
▶ ✓ file_edit src/ui/App.tsx (+12/-5)

▼ ✓ file_edit src/ui/App.tsx (+12/-5)
    @@ -45,7 +45,12 @@
     const [mode, setMode] = useState("AUTO");
    -const [loading, setLoading] = useState(false);
    +const [loading, setLoading] = useState(false);
    +const [error, setError] = useState<string | null>(null);
```

**Estimated time**: 45 minutes

#### Chunk 2.6: Simple Diff Renderer
**File**: `src/ui/components/DiffView.tsx` (NEW)
**Changes**:
- Parse unified diff format
- Render with colored +/- lines
- No syntax highlighting (keep simple)
- Truncate if > 20 changed lines

**Estimated time**: 30 minutes

#### Chunk 2.7: Glob/Grep Display
**File**: `src/ui/components/MessageBlock.tsx`
**Changes**:
- Show pattern + match count
- No expanded view needed

**Mockup**:
```
✓ glob "**/*.ts" (47 matches)
✓ grep "useState" in src/ (12 matches)
```

**Estimated time**: 15 minutes

#### Chunk 2.8: Task (Subagent) Display
**File**: `src/ui/components/MessageBlock.tsx`
**Changes**:
- Show subagent type + description on collapsed
- Show action summaries when expanded
- Show tool call count

**Mockup**:
```
▶ ✓ task [explore] "Find API endpoints"

▼ ✓ task [explore] "Find API endpoints" (5 tool calls)
    └─ glob "**/*.ts" (23 matches)
    └─ grep "router" (8 matches)
    └─ file_read src/api/routes.ts
```

**Estimated time**: 20 minutes

**Phase 2 Total**: ~3.5 hours

---

### Phase 3: Polish & Integration

#### Chunk 3.1: Auto-Expand Errors
**Changes**:
- Errors auto-expand by default
- Show full error message
- Red border or background highlight

**Estimated time**: 15 minutes

#### Chunk 3.2: Attempt Counter Display
**Changes**:
- Track attempts per tool call ID pattern
- Show "(attempt 2/3)" when retrying
- Reset counter on success

**Note**: This requires tracking state across tool calls, may need context

**Estimated time**: 30 minutes

#### Chunk 3.3: Output Truncation Safety
**Changes**:
- Hard limit: 100 lines displayed max
- Hard limit: 5000 chars displayed max
- "Output truncated..." indicator
- Prevents UI crash on massive output

**Estimated time**: 20 minutes

#### Chunk 3.4: Looper Skill Integration
**Changes**:
- Visual indicator when looper engages
- "Retrying with different approach..." message
- Link to looper skill documentation

**Estimated time**: 30 minutes

**Phase 3 Total**: ~1.5 hours

---

## File Changes Summary

| File | Change Type | Phase |
|------|-------------|-------|
| `src/ui/components/MessageBlock.tsx` | Major refactor | 1, 2 |
| `src/tools/bash.ts` | Add metadata | 1 |
| `src/tools/file-write.ts` | Add metadata | 1 |
| `src/tools/file-edit.ts` | Add metadata + diff | 1 |
| `src/tools/file-read.ts` | Add metadata | 1 |
| `src/tools/glob.ts` | Add metadata | 1 |
| `src/tools/grep.ts` | Add metadata | 1 |
| `src/tools/task.ts` | Enhance metadata | 1 |
| `src/ui/components/ToolBlock.tsx` | NEW | 2 |
| `src/ui/components/DiffView.tsx` | NEW | 2 |
| `package.json` | Add `diff` dependency | 1 |

---

## Dependencies

```bash
bun add diff
bun add -d @types/diff
```

---

## Testing Checklist

### Phase 1 Tests
- [ ] Bash tool returns proper metadata
- [ ] File write counts lines correctly
- [ ] File edit generates valid unified diff
- [ ] Glob/grep return match counts
- [ ] Task tool parses actions correctly

### Phase 2 Tests
- [ ] Collapsed view shows summary
- [ ] Click expands/collapses
- [ ] Errors auto-expand
- [ ] Diff colors correct (green +, red -)
- [ ] Long output truncates gracefully

### Phase 3 Tests
- [ ] Massive output doesn't crash UI
- [ ] Attempt counter increments on retry
- [ ] Looper indicator appears when engaged

---

## Rollback Plan

If issues arise:
1. Each phase is independently committable
2. Can revert to v0.10.2 baseline
3. Feature flags possible for gradual rollout

---

## Version Milestones

| Version | Content |
|---------|---------|
| v0.10.2 | Current baseline |
| v0.11.0 | Phase 1 complete (metadata infrastructure) |
| v0.12.0 | Phase 2 complete (UI components) |
| v0.13.0 | Phase 3 complete (polish) |

---

## Notes for Future Sessions

### Context Recovery
If you're resuming this work after compaction:
1. Read this document first
2. Check `git log` for last completed chunk
3. Check `git status` for in-progress work
4. Run `bun run build` to verify state

### Key Files to Review
- `src/ui/components/MessageBlock.tsx` - Main tool display logic
- `src/tools/*.ts` - Individual tool implementations
- `CHANGELOG.md` - What's been released

### Design References
- OpenCode: `/home/spenceriam/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- Geoffrey Huntley's Ralph philosophy: https://ghuntley.com/ralph/
- Looper skill: `.opencode/skills/looper/SKILL.md`
