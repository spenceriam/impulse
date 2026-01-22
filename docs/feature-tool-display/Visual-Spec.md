# Tool Display Refactor - Visual Specification

> Comprehensive ASCII mockups for all tool display states and scenarios

Generated: 01-22-2026
Status: Planned Enhancement (Outside Original MVP Scope)

---

## Design Philosophy

Following the brutalist design principles from AGENTS.md:
- **No emojis** - ASCII indicators only
- **Function over decoration** - Every element serves a purpose
- **High contrast** - Clear visual hierarchy
- **Monospace precision** - Embrace the grid

---

## Color Reference

From `src/ui/design.ts`:

| Element | Color | Hex | Usage |
|---------|-------|-----|-------|
| Success indicator | Dim gray | `#666666` | ✓ checkmark |
| Error indicator | Red | `#ff6b6b` | ✗ X mark |
| Running indicator | Dim gray | `#666666` | ~ tilde |
| Pending indicator | Dim gray | `#666666` | · dot |
| Diff addition | Green | `#6fca6f` | + lines |
| Diff deletion | Red | `#ff6b6b` | - lines |
| Tool title text | Dim gray | `#666666` | Tool name and args |
| Expand indicator | Dim gray | `#666666` | ▶ ▼ arrows |

---

## Component Anatomy

### Collapsed Tool Block

```
┌─────────────────────────────────────────────────────────────────────┐
│ ▶ ✓ bash "install dependencies"                                    │
│ │ │ └─────────────┬─────────────┘                                  │
│ │ │               │                                                 │
│ │ │               └── Title text (dim gray #666666)                │
│ │ │                                                                 │
│ │ └── Status indicator (✓=dim, ✗=red, ~=dim, ·=dim)               │
│ │                                                                   │
│ └── Expand indicator (▶=collapsed, ▼=expanded) (dim gray)          │
└─────────────────────────────────────────────────────────────────────┘
```

### Expanded Tool Block

```
┌─────────────────────────────────────────────────────────────────────┐
│ ▼ ✓ bash "install dependencies"     ← Clickable header line        │
│     $ npm install zod openai        ← Expanded content starts here │
│     added 42 packages in 2.3s       ← 4-space indent from left     │
│     ✓ All packages installed                                       │
│     ... (15 more lines)             ← Truncation indicator         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Status Indicators

### Character Reference

| Status | Indicator | Color | Auto-Expand |
|--------|-----------|-------|-------------|
| Pending | `·` | Dim gray (#666666) | No |
| Running | `~` | Dim gray (#666666) | No |
| Success | `✓` | Dim gray (#666666) | No |
| Error | `✗` | Red (#ff6b6b) | **Yes** |

### Visual Examples

```
Pending:    ▶ · bash "waiting..."
Running:    ▶ ~ bash "installing..."
Success:    ▶ ✓ bash "install dependencies"
Error:      ▼ ✗ bash "npm test" (exit 1)    ← Note: auto-expanded
```

---

## Tool-Specific Mockups

### 1. Bash Tool

#### Collapsed (Success)
```
▶ ✓ bash "install dependencies"
```

#### Collapsed (With Exit Code - Error)
```
▼ ✗ bash "npm test" (exit 1)
```

#### Expanded (Success - Short Output)
```
▼ ✓ bash "install dependencies"
    $ npm install zod openai
    added 42 packages in 2.3s
```

#### Expanded (Success - Long Output, First 3 Lines)
```
▼ ✓ bash "install dependencies"
    $ npm install zod openai @opentui/core @opentui/solid solid-js
    npm warn deprecated inflight@1.0.6: This module is not supported
    npm warn deprecated glob@7.2.3: Glob versions prior to v9 are no
    ... (42 more lines)
```

#### Expanded (Error - Auto-Expanded)
```
▼ ✗ bash "npm test" (exit 1)
    $ npm test
    FAIL src/components/App.test.ts
    Expected: true
    Received: false
```

#### With Working Directory
```
▶ ✓ bash "run tests" in src/
    $ npm test
    All tests passed
```

---

### 2. File Write Tool

#### Standard Display (No Expand)
```
  ✓ file_write src/api/client.ts (142 lines)
```

Note: No ▶ indicator because there's no expandable content.

#### New File Created
```
  ✓ file_write src/api/client.ts (142 lines, created)
```

#### Overwritten File
```
  ✓ file_write src/api/client.ts (142 lines)
```

---

### 3. File Edit Tool

#### Collapsed
```
▶ ✓ file_edit src/ui/App.tsx (+12/-5)
```

#### Expanded (With Diff)
```
▼ ✓ file_edit src/ui/App.tsx (+12/-5)
    @@ -45,7 +45,12 @@
     import { useState } from "solid-js";
     
     const [mode, setMode] = useState("AUTO");
    -const [loading, setLoading] = useState(false);
    +const [loading, setLoading] = useState(false);
    +const [error, setError] = useState<string | null>(null);
    +const [retryCount, setRetryCount] = useState(0);
     
     function handleSubmit() {
```

#### Diff Color Coding
```
    @@ -45,7 +45,12 @@                    ← Dim gray (#666666)
     import { useState } from "solid-js";  ← White (context line)
                                           
    -const [loading, setLoading]...        ← RED (#ff6b6b)
    +const [loading, setLoading]...        ← GREEN (#6fca6f)
    +const [error, setError]...            ← GREEN (#6fca6f)
```

#### Long Diff (Truncated)
```
▼ ✓ file_edit src/ui/App.tsx (+45/-23)
    @@ -10,15 +10,25 @@
    -import { foo } from "./foo";
    +import { foo, bar } from "./foo";
    +import { baz } from "./baz";
     
     // Component definition
    -export function App() {
    +export function App(props: AppProps) {
    ... (38 more changes)
```

#### Error (File Not Found)
```
▼ ✗ file_edit src/nonexistent.ts
    Error: File not found: src/nonexistent.ts
```

#### Error (oldString Not Found)
```
▼ ✗ file_edit src/ui/App.tsx
    Error: oldString not found in file
```

---

### 4. File Read Tool

#### Standard Display (No Expand)
```
  ✓ file_read src/ui/App.tsx (245 lines)
```

#### With Truncation Indicator
```
  ✓ file_read src/api/client.ts (2000 lines, truncated)
```

#### With Offset/Limit
```
  ✓ file_read src/api/client.ts (lines 100-200)
```

---

### 5. Glob Tool

#### Standard Display (No Expand)
```
  ✓ glob "**/*.ts" (47 matches)
```

#### With Path Specified
```
  ✓ glob "*.tsx" in src/ui/components (12 matches)
```

#### No Matches
```
  ✓ glob "**/*.rs" (0 matches)
```

---

### 6. Grep Tool

#### Standard Display (No Expand)
```
  ✓ grep "useState" (23 matches)
```

#### With Path Specified
```
  ✓ grep "TODO" in src/ (5 matches)
```

#### No Matches
```
  ✓ grep "FIXME" (0 matches)
```

---

### 7. Task Tool (Subagent)

#### Collapsed
```
▶ ✓ task [explore] "Find API endpoints"
```

#### Expanded (With Actions)
```
▼ ✓ task [explore] "Find API endpoints" (5 tool calls)
    └─ glob "**/*.ts" (23 matches)
    └─ grep "router" (8 matches)
    └─ file_read src/api/routes.ts
    └─ file_read src/api/endpoints.ts
    └─ grep "endpoint" (12 matches)
```

#### With More Actions (Truncated)
```
▼ ✓ task [general] "Refactor authentication" (12 tool calls)
    └─ file_read src/auth/login.ts
    └─ file_edit src/auth/login.ts (+15/-8)
    └─ file_read src/auth/logout.ts
    └─ file_edit src/auth/logout.ts (+10/-5)
    └─ file_write src/auth/types.ts (45 lines)
    ... (7 more actions)
```

#### Error in Subagent
```
▼ ✗ task [general] "Run tests"
    └─ bash "npm test" (error)
    Error: Tests failed with exit code 1
```

---

## Looper/Retry Visibility

### Consecutive Failures (Attempt Counter)

```
▼ ✗ bash "npm test" (attempt 1)
    $ npm test
    FAIL: 3 tests failed

▼ ✗ bash "npm test" (attempt 2)
    $ npm test
    FAIL: 2 tests failed

▼ ✗ bash "npm test" (attempt 3)
    $ npm test
    FAIL: 1 test failed

▶ ✓ bash "npm test"
    $ npm test
    All tests passed
```

### Attempt Counter Format
```
(attempt N)  ← Shown in yellow (#e6c655) after tool title
```

---

## Context: Full Message with Tool Calls

### Assistant Message with Multiple Tools
```
┌─────────────────────────────────────────────────────────────────────┐
│ GLM-4.7 [AGENT]                                                     │
│                                                                     │
│ I'll help you set up the API client. Let me first check the        │
│ existing code structure and then create the necessary files.        │
│                                                                     │
│ ▶ ✓ glob "src/**/*.ts" (23 matches)                                │
│ ▶ ✓ file_read src/api/index.ts (45 lines)                          │
│ ▶ ✓ file_write src/api/client.ts (142 lines)                       │
│ ▶ ✓ file_edit src/api/index.ts (+3/-1)                             │
│                                                                     │
│ I've created the API client and updated the exports. The client    │
│ includes error handling and retry logic.                           │
└─────────────────────────────────────────────────────────────────────┘
```

### Message with Expanded Tool
```
┌─────────────────────────────────────────────────────────────────────┐
│ GLM-4.7 [AGENT]                                                     │
│                                                                     │
│ Running the tests now...                                           │
│                                                                     │
│ ▼ ✓ bash "npm test"                                                │
│     $ npm test                                                      │
│     PASS src/api/client.test.ts                                    │
│     PASS src/ui/App.test.ts                                        │
│     ... (5 more lines)                                             │
│                                                                     │
│ All tests passed! The implementation is complete.                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Message with Error
```
┌─────────────────────────────────────────────────────────────────────┐
│ GLM-4.7 [AGENT]                                                     │
│                                                                     │
│ Let me try to fix that test...                                     │
│                                                                     │
│ ▼ ✗ bash "npm test" (exit 1)                 ← Red, auto-expanded  │
│     $ npm test                                                      │
│     FAIL src/api/client.test.ts                                    │
│     Expected: "success"                                            │
│     Received: "error"                                              │
│                                                                     │
│ I see the issue. The mock wasn't set up correctly. Let me fix it.  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Spacing and Indentation

### Indentation Rules

| Element | Indent | Notes |
|---------|--------|-------|
| Tool block from message | 0 | Flush with message content |
| Expand indicator | 0 | First character |
| Status indicator | After expand (1 space) | `▶ ✓` |
| Tool title | After status (1 space) | `▶ ✓ bash...` |
| Expanded content | 4 spaces | From left edge |
| Nested actions (task) | 4 spaces | Same as expanded content |

### Character Widths

```
▶ ✓ bash "install dependencies"
│ │ └───────────────┬─────────┘
│ │                 │
│ │                 └── Variable width (tool title)
│ │
│ └── 1 char (status indicator)
│
└── 1 char (expand indicator) + 1 space
```

---

## Interactive Behavior

### Click Targets

```
┌─────────────────────────────────────────────────────────────────────┐
│ ▶ ✓ bash "install dependencies"                                    │
│ ├──────────────────────────────┤                                   │
│ │      ENTIRE LINE IS CLICKABLE                                    │
│ │      Click anywhere to toggle expand/collapse                     │
│ └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### State Transitions

```
Initial State (Success):
  ▶ ✓ tool_name args    (collapsed)
       │
       │ User clicks
       ▼
  ▼ ✓ tool_name args    (expanded)
      [expanded content]
       │
       │ User clicks again
       ▼
  ▶ ✓ tool_name args    (collapsed)


Initial State (Error):
  ▼ ✗ tool_name args    (auto-expanded)
      [error details]
       │
       │ User clicks
       ▼
  ▶ ✗ tool_name args    (collapsed)
       │
       │ User clicks again
       ▼
  ▼ ✗ tool_name args    (expanded)
```

---

## Edge Cases

### Very Long Tool Title (Truncation)
```
▶ ✓ bash "npm install @opentui/core @opentui/solid sol..."
```
Truncate at ~60 characters with "..."

### Very Long File Path
```
▶ ✓ file_edit src/ui/components/features/auth/login/L...
```

### Empty Output (Bash)
```
▼ ✓ bash "touch newfile.ts"
    $ touch newfile.ts
    (no output)
```

### Multi-line Command
```
▼ ✓ bash "install and build"
    $ npm install && npm run build
    added 42 packages
    Build successful
```

---

## Comparison: Before vs After

### Current Implementation (Before)
```
↳ bash echo "hello"
↳ file_write src/foo.ts
↳ file_edit src/bar.ts
↳ glob "**/*.ts"
✗ bash npm test (error)
```

### New Implementation (After)
```
▶ ✓ bash "echo hello"
  ✓ file_write src/foo.ts (12 lines)
▶ ✓ file_edit src/bar.ts (+5/-2)
  ✓ glob "**/*.ts" (47 matches)
▼ ✗ bash "npm test" (exit 1)
    $ npm test
    FAIL: Tests failed
```

Key improvements:
1. Collapsible blocks for tools with output
2. Metadata summary in title (line counts, diff stats)
3. Unified diff view for file edits
4. Auto-expand errors
5. Status indicators (✓/✗/~/·)
6. Consistent formatting

---

## Implementation Checklist

Use this to verify the visual implementation matches the spec:

- [ ] Expand indicator shows ▶ (collapsed) or ▼ (expanded)
- [ ] Status indicators: ✓ (success), ✗ (error), ~ (running), · (pending)
- [ ] Success status is dim gray (#666666)
- [ ] Error status is red (#ff6b6b)
- [ ] Errors auto-expand
- [ ] Click anywhere on header line toggles expand
- [ ] Expanded content indented 4 spaces
- [ ] Bash shows `$ command` in expanded view
- [ ] Bash shows first 3 lines of output
- [ ] Bash shows "... (N more lines)" if truncated
- [ ] File edit shows diff stats in title: (+N/-M)
- [ ] File edit expanded shows unified diff
- [ ] Diff additions colored green (#6fca6f)
- [ ] Diff deletions colored red (#ff6b6b)
- [ ] File write shows line count
- [ ] Glob/Grep shows match count
- [ ] Task shows subagent type and description
- [ ] Task expanded shows action summaries
- [ ] Attempt counter shows for consecutive failures
