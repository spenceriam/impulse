# Tool Display Refactor - Tasks

> Implementation tasks using BMAD-method with detailed before/after states

Generated: 01-22-2026
Status: Planned Enhancement (Outside Original MVP Scope)
Baseline Version: v0.10.2

---

## Overview

3 phases, sequential execution. Each task includes exact file paths, before/after code blocks, step-by-step instructions, and verification steps.

| Phase | Name | Tasks | Est. Effort |
|-------|------|-------|-------------|
| 1 | Data Infrastructure | 9 | ~2.5 hours |
| 2 | UI Components | 6 | ~3 hours |
| 3 | Polish & Looper Integration | 4 | ~1.5 hours |

**Total Estimated Effort:** ~7 hours

---

## Phase 1: Data Infrastructure

> Install dependencies, create type definitions, update tools to return structured metadata

---

### Task 1.1: Install diff Package

**Prerequisites:** None
**Dependencies:** npm/bun package manager
**Estimated Effort:** Small (5 minutes)

#### Description
Install the `diff` npm package for generating unified diffs in the file_edit tool.

#### Before
**File:** `package.json` (lines 13-25)
```json
  "dependencies": {
    "@opentui/core": "^0.1.74",
    "@opentui/solid": "^0.1.74",
    "openai": "^4.73.0",
    "solid-js": "^1.9.0",
    "zod": "^3.24.0",
    "zod-to-json-schema": "^3.25.1"
  },
  "devDependencies": {
    "@types/bun": "^1.3.6",
    "@types/node": "^22.10.0",
    "typescript": "^5.7.0"
  },
```

#### After
**File:** `package.json` (lines 13-27)
```json
  "dependencies": {
    "@opentui/core": "^0.1.74",
    "@opentui/solid": "^0.1.74",
    "diff": "^8.0.0",
    "openai": "^4.73.0",
    "solid-js": "^1.9.0",
    "zod": "^3.24.0",
    "zod-to-json-schema": "^3.25.1"
  },
  "devDependencies": {
    "@types/bun": "^1.3.6",
    "@types/diff": "^6.0.0",
    "@types/node": "^22.10.0",
    "typescript": "^5.7.0"
  },
```

#### Steps
1. Run: `bun add diff`
2. Run: `bun add -d @types/diff`
3. Verify package.json updated

#### Verification
- [ ] `bun install` completes without errors
- [ ] `import { createPatch } from "diff"` compiles in TypeScript
- [ ] Run `bun run build` - no new errors

---

### Task 1.2: Create Tool Metadata Types

**Prerequisites:** None
**Dependencies:** None
**Estimated Effort:** Small (15 minutes)

#### Description
Create a new file with TypeScript interfaces for all tool metadata types.

#### Before
**File:** `src/types/tool-metadata.ts`
```
(File does not exist)
```

#### After
**File:** `src/types/tool-metadata.ts` (NEW - 98 lines)
```typescript
/**
 * Tool Metadata Types
 * Structured data returned by tools for enhanced UI display
 * 
 * Each tool returns metadata with a discriminated union type field
 * to enable type-safe rendering in the UI.
 */

// ============================================
// Bash Tool Metadata
// ============================================
export interface BashMetadata {
  type: "bash";
  command: string;           // The full command executed
  description?: string;      // Description from tool args
  output: string;            // Combined stdout + stderr
  exitCode: number;          // Process exit code (0 = success)
  truncated: boolean;        // True if output exceeded limit
  workdir?: string;          // Working directory if specified
}

// ============================================
// File Write Tool Metadata
// ============================================
export interface FileWriteMetadata {
  type: "file_write";
  filePath: string;          // Absolute or relative path
  linesWritten: number;      // Number of lines in content
  created: boolean;          // True if file was created (vs overwritten)
}

// ============================================
// File Edit Tool Metadata
// ============================================
export interface FileEditMetadata {
  type: "file_edit";
  filePath: string;          // Absolute or relative path
  diff: string;              // Unified diff format string
  linesAdded: number;        // Count of lines with + prefix
  linesRemoved: number;      // Count of lines with - prefix
}

// ============================================
// File Read Tool Metadata
// ============================================
export interface FileReadMetadata {
  type: "file_read";
  filePath: string;          // Absolute or relative path
  linesRead: number;         // Number of lines returned
  truncated: boolean;        // True if content was truncated
}

// ============================================
// Glob Tool Metadata
// ============================================
export interface GlobMetadata {
  type: "glob";
  pattern: string;           // Glob pattern used
  path?: string;             // Search root path if specified
  matchCount: number;        // Number of files matched
}

// ============================================
// Grep Tool Metadata
// ============================================
export interface GrepMetadata {
  type: "grep";
  pattern: string;           // Regex pattern searched
  path?: string;             // Search root path
  matchCount: number;        // Number of matches found
}

// ============================================
// Task (Subagent) Tool Metadata
// ============================================
export interface TaskMetadata {
  type: "task";
  subagentType: string;      // "explore" | "general"
  description: string;       // Task description
  actions: string[];         // Summary of actions taken (max 5)
  toolCallCount: number;     // Total tool calls made by subagent
}

// ============================================
// Union Type
// ============================================
export type ToolMetadata =
  | BashMetadata
  | FileWriteMetadata
  | FileEditMetadata
  | FileReadMetadata
  | GlobMetadata
  | GrepMetadata
  | TaskMetadata;

// ============================================
// Type Guards
// ============================================
export function isBashMetadata(m: ToolMetadata): m is BashMetadata {
  return m.type === "bash";
}

export function isFileEditMetadata(m: ToolMetadata): m is FileEditMetadata {
  return m.type === "file_edit";
}

export function isFileWriteMetadata(m: ToolMetadata): m is FileWriteMetadata {
  return m.type === "file_write";
}

export function isFileReadMetadata(m: ToolMetadata): m is FileReadMetadata {
  return m.type === "file_read";
}

export function isGlobMetadata(m: ToolMetadata): m is GlobMetadata {
  return m.type === "glob";
}

export function isGrepMetadata(m: ToolMetadata): m is GrepMetadata {
  return m.type === "grep";
}

export function isTaskMetadata(m: ToolMetadata): m is TaskMetadata {
  return m.type === "task";
}
```

#### Steps
1. Create directory if needed: `mkdir -p src/types`
2. Create file `src/types/tool-metadata.ts`
3. Copy the exact content from "After" block above
4. Run `bun run build` to verify types compile

#### Verification
- [ ] File exists at `src/types/tool-metadata.ts`
- [ ] `bun run build` completes without type errors
- [ ] Can import: `import { BashMetadata, ToolMetadata } from "../types/tool-metadata"`

---

### Task 1.3: Update ToolCallInfo Interface

**Prerequisites:** Task 1.2
**Dependencies:** None
**Estimated Effort:** Small (10 minutes)

#### Description
Add optional `metadata` field to the `ToolCallInfo` interface in MessageBlock.tsx.

#### Before
**File:** `src/ui/components/MessageBlock.tsx` (lines 1-18)
```typescript
import { For, Show } from "solid-js";
import { Colors, type Mode, getModeColor } from "../design";

// Background colors for message types (per design spec)
const USER_MESSAGE_BG = "#1a2a2a";    // Dark cyan tint for user messages
const THINKING_BG = "#1f1f1f";        // Lighter dark gray for thinking
const ASSISTANT_BG = "#141414";       // Darker gray for AI response

/**
 * Tool call display info
 */
export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: string;
  status: "pending" | "running" | "success" | "error";
  result?: string;
}
```

#### After
**File:** `src/ui/components/MessageBlock.tsx` (lines 1-20)
```typescript
import { For, Show } from "solid-js";
import { Colors, type Mode, getModeColor } from "../design";
import type { ToolMetadata } from "../../types/tool-metadata";

// Background colors for message types (per design spec)
const USER_MESSAGE_BG = "#1a2a2a";    // Dark cyan tint for user messages
const THINKING_BG = "#1f1f1f";        // Lighter dark gray for thinking
const ASSISTANT_BG = "#141414";       // Darker gray for AI response

/**
 * Tool call display info
 */
export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: string;
  status: "pending" | "running" | "success" | "error";
  result?: string;
  metadata?: ToolMetadata;  // NEW: Structured metadata for enhanced display
}
```

#### Steps
1. Open `src/ui/components/MessageBlock.tsx`
2. Add import for ToolMetadata after line 2
3. Add `metadata?: ToolMetadata;` field to ToolCallInfo interface after `result?`
4. Save and verify build

#### Verification
- [ ] Import statement added on line 3
- [ ] `metadata?: ToolMetadata;` field added to interface
- [ ] `bun run build` completes without errors

---

### Task 1.4: Update Bash Tool to Return BashMetadata

**Prerequisites:** Task 1.2, Task 1.3
**Dependencies:** None
**Estimated Effort:** Medium (20 minutes)

#### Description
Modify bash.ts to return structured BashMetadata in the result.

#### Before
**File:** `src/tools/bash.ts` (lines 219-228)
```typescript
      const elapsed = Date.now() - startTime;
      const exitCode = result.exitCode ?? 0;

      return {
        success: true,
        output: output || "Command completed successfully.",
        metadata: {
          duration: elapsed,
          truncated: outputLines.length >= maxLines,
          exitCode,
        },
      };
```

#### After
**File:** `src/tools/bash.ts` (lines 219-236)
```typescript
      const elapsed = Date.now() - startTime;
      const exitCode = result.exitCode ?? 0;
      const wasTruncated = outputLines.length >= maxLines;

      return {
        success: exitCode === 0,
        output: output || "Command completed successfully.",
        metadata: {
          // Legacy fields (keep for backwards compatibility)
          duration: elapsed,
          truncated: wasTruncated,
          exitCode,
          // NEW: BashMetadata fields for enhanced display
          type: "bash",
          command: input.command,
          description: input.description,
          workdir: input.workdir,
        },
      };
```

#### Also update error case
**File:** `src/tools/bash.ts` (lines 241-252) - error return

#### Before
```typescript
        return {
          success: false,
          output,
        };
```

#### After
```typescript
        return {
          success: false,
          output,
          metadata: {
            type: "bash",
            command: input.command,
            description: input.description,
            output,
            exitCode: -1,
            truncated: false,
            workdir: input.workdir,
          },
        };
```

#### Steps
1. Open `src/tools/bash.ts`
2. Find the success return block (~line 220)
3. Add the new metadata fields as shown
4. Find the error return block (~line 241)
5. Add metadata to error case
6. Ensure `type: "bash"` is included in both cases
7. Run build to verify

#### Verification
- [ ] Success case returns `metadata.type: "bash"`
- [ ] Success case returns `metadata.command`
- [ ] Error case returns structured metadata
- [ ] `bun run build` completes without errors
- [ ] Manual test: Run app, execute bash command, check metadata in debug

---

### Task 1.5: Update File Write Tool to Return FileWriteMetadata

**Prerequisites:** Task 1.2, Task 1.3
**Dependencies:** None
**Estimated Effort:** Small (15 minutes)

#### Description
Modify file-write.ts to return structured FileWriteMetadata.

#### Before
**File:** `src/tools/file-write.ts` (lines 73-83)
```typescript
      writeFileSync(safePath, input.content, "utf-8");

      if (existingPermissions !== undefined) {
        const stats = statSync(safePath);
        stats.mode = existingPermissions;
      }

      return {
        success: true,
        output: `File written successfully: ${input.filePath}`,
      };
```

#### After
**File:** `src/tools/file-write.ts` (lines 73-90)
```typescript
      writeFileSync(safePath, input.content, "utf-8");

      if (existingPermissions !== undefined) {
        const stats = statSync(safePath);
        stats.mode = existingPermissions;
      }

      // Count lines written
      const linesWritten = input.content.split("\n").length;

      return {
        success: true,
        output: `File written successfully: ${input.filePath}`,
        metadata: {
          type: "file_write",
          filePath: input.filePath,
          linesWritten,
          created: isNewFile,
        },
      };
```

#### Steps
1. Open `src/tools/file-write.ts`
2. Add line counting before the return statement
3. Add metadata object with type, filePath, linesWritten, created
4. Note: `isNewFile` is already calculated earlier in the function (line 44)
5. Run build to verify

#### Verification
- [ ] `metadata.type` is `"file_write"`
- [ ] `metadata.linesWritten` is calculated from content
- [ ] `metadata.created` uses existing `isNewFile` variable
- [ ] `bun run build` completes without errors

---

### Task 1.6: Update File Edit Tool to Generate Diff and Return FileEditMetadata

**Prerequisites:** Task 1.1 (diff package), Task 1.2, Task 1.3
**Dependencies:** diff package installed
**Estimated Effort:** Medium (25 minutes)

#### Description
Modify file-edit.ts to capture old content, generate unified diff, and return FileEditMetadata.

#### Before
**File:** `src/tools/file-edit.ts` (lines 1-11)
```typescript
import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { readFileSync, writeFileSync } from "fs";
import { resolve, relative, isAbsolute } from "path";
import { sanitizePath } from "../util/path";
import { ask as askPermission } from "../permission";

const DESCRIPTION = readFileSync(
  new URL("./file-edit.txt", import.meta.url),
  "utf-8"
);
```

#### After
**File:** `src/tools/file-edit.ts` (lines 1-12)
```typescript
import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { readFileSync, writeFileSync } from "fs";
import { resolve, relative, isAbsolute } from "path";
import { createPatch } from "diff";
import { sanitizePath } from "../util/path";
import { ask as askPermission } from "../permission";

const DESCRIPTION = readFileSync(
  new URL("./file-edit.txt", import.meta.url),
  "utf-8"
);
```

#### Before
**File:** `src/tools/file-edit.ts` (lines 89-99)
```typescript
        newContent = content.substring(0, index) + input.newString + content.substring(index + input.oldString.length);
      }

      writeFileSync(safePath, newContent, "utf-8");

      return {
        success: true,
        output: `File edited successfully: ${input.filePath}`,
        metadata: {
          replacements: input.replaceAll ? occurrences : 1,
        },
      };
```

#### After
**File:** `src/tools/file-edit.ts` (lines 89-115)
```typescript
        newContent = content.substring(0, index) + input.newString + content.substring(index + input.oldString.length);
      }

      // Generate unified diff before writing
      const diff = createPatch(
        input.filePath,
        content,      // old content
        newContent,   // new content
        "original",
        "modified"
      );

      // Count added/removed lines from diff
      const diffLines = diff.split("\n");
      const linesAdded = diffLines.filter(l => l.startsWith("+") && !l.startsWith("+++")).length;
      const linesRemoved = diffLines.filter(l => l.startsWith("-") && !l.startsWith("---")).length;

      writeFileSync(safePath, newContent, "utf-8");

      return {
        success: true,
        output: `File edited successfully: ${input.filePath}`,
        metadata: {
          type: "file_edit",
          filePath: input.filePath,
          diff,
          linesAdded,
          linesRemoved,
          replacements: input.replaceAll ? occurrences : 1,
        },
      };
```

#### Steps
1. Open `src/tools/file-edit.ts`
2. Add import for `createPatch` from "diff" package (line 5)
3. Find the section after `newContent` is computed (~line 89)
4. Add diff generation using `createPatch`
5. Add line counting for linesAdded and linesRemoved
6. Move `writeFileSync` after diff generation
7. Add metadata object with all FileEditMetadata fields
8. Run build to verify

#### Verification
- [ ] Import `{ createPatch } from "diff"` added
- [ ] Diff generated BEFORE writing file (so we have old content)
- [ ] `metadata.type` is `"file_edit"`
- [ ] `metadata.diff` contains unified diff string
- [ ] `metadata.linesAdded` and `linesRemoved` calculated correctly
- [ ] `bun run build` completes without errors

---

### Task 1.7: Update File Read Tool to Return FileReadMetadata

**Prerequisites:** Task 1.2, Task 1.3
**Dependencies:** None
**Estimated Effort:** Small (10 minutes)

#### Description
Modify file-read.ts to return structured FileReadMetadata.

#### Before
**File:** `src/tools/file-read.ts` (lines 68-76)
```typescript
      return {
        success: true,
        output: `${header}\n${outputLines.join("\n")}`,
        metadata: {
          totalLines: lines.length,
          returnedLines: selectedLines.length,
          offset,
        },
      };
```

#### After
**File:** `src/tools/file-read.ts` (lines 68-79)
```typescript
      return {
        success: true,
        output: `${header}\n${outputLines.join("\n")}`,
        metadata: {
          // Legacy fields
          totalLines: lines.length,
          returnedLines: selectedLines.length,
          offset,
          // NEW: FileReadMetadata fields
          type: "file_read",
          filePath: input.filePath,
          linesRead: selectedLines.length,
          truncated: selectedLines.length < lines.length,
        },
      };
```

#### Steps
1. Open `src/tools/file-read.ts`
2. Find the success return block (~line 68)
3. Add new metadata fields while keeping legacy fields
4. Run build to verify

#### Verification
- [ ] `metadata.type` is `"file_read"`
- [ ] `metadata.truncated` correctly indicates if content was cut
- [ ] Legacy fields preserved for backwards compatibility
- [ ] `bun run build` completes without errors

---

### Task 1.8: Update Glob Tool to Return GlobMetadata

**Prerequisites:** Task 1.2, Task 1.3
**Dependencies:** None
**Estimated Effort:** Small (10 minutes)

#### Description
Modify glob.ts to return structured GlobMetadata.

#### Before
**File:** `src/tools/glob.ts` (lines 38-44)
```typescript
      return {
        success: true,
        output: sortedFiles.join("\n"),
        metadata: {
          count: sortedFiles.length,
        },
      };
```

#### After
**File:** `src/tools/glob.ts` (lines 38-47)
```typescript
      return {
        success: true,
        output: sortedFiles.join("\n"),
        metadata: {
          // Legacy field
          count: sortedFiles.length,
          // NEW: GlobMetadata fields
          type: "glob",
          pattern: input.pattern,
          path: input.path,
          matchCount: sortedFiles.length,
        },
      };
```

#### Steps
1. Open `src/tools/glob.ts`
2. Find the success return block (~line 38)
3. Add new metadata fields
4. Run build to verify

#### Verification
- [ ] `metadata.type` is `"glob"`
- [ ] `metadata.pattern` contains the glob pattern
- [ ] `metadata.matchCount` equals file count
- [ ] `bun run build` completes without errors

---

### Task 1.9: Update Grep Tool to Return GrepMetadata

**Prerequisites:** Task 1.2, Task 1.3
**Dependencies:** None
**Estimated Effort:** Small (10 minutes)

#### Description
Modify grep.ts to return structured GrepMetadata.

#### Before
**File:** `src/tools/grep.ts` (lines 76-82)
```typescript
      return {
        success: true,
        output: grepOutputLines.join("\n"),
        metadata: {
          count: sortedMatches.length,
        },
      };
```

#### After
**File:** `src/tools/grep.ts` (lines 76-85)
```typescript
      return {
        success: true,
        output: grepOutputLines.join("\n"),
        metadata: {
          // Legacy field
          count: sortedMatches.length,
          // NEW: GrepMetadata fields
          type: "grep",
          pattern: input.pattern,
          path: input.path,
          matchCount: sortedMatches.length,
        },
      };
```

#### Steps
1. Open `src/tools/grep.ts`
2. Find the success return block (~line 76)
3. Add new metadata fields
4. Run build to verify

#### Verification
- [ ] `metadata.type` is `"grep"`
- [ ] `metadata.pattern` contains the search pattern
- [ ] `metadata.matchCount` equals match count
- [ ] `bun run build` completes without errors

---

## Phase 1 Checkpoint

After completing all Phase 1 tasks:

1. Run `bun run build` - should complete without errors
2. Run `bun run start` - app should start normally
3. All tools return metadata with `type` field
4. Commit: `git add -A && git commit -m "feat(tools): add structured metadata to all tools"`

---

## Phase 2: UI Components

> Create collapsible tool block, diff view, and update tool display rendering

---

### Task 2.1: Add Status Indicators to Design Constants

**Prerequisites:** None
**Dependencies:** None
**Estimated Effort:** Small (10 minutes)

#### Description
Add new status indicator constants for the enhanced tool display.

#### Before
**File:** `src/ui/design.ts` (lines 84-92)
```typescript
  /**
   * Tool result indicators
   */
  tool: {
    pending: "▶",         // Tool waiting to run
    running: "⣾",         // Tool currently executing (spinner frame)
    success: "[OK]",      // Tool succeeded
    error: "[FAIL]",      // Tool failed
  },
```

#### After
**File:** `src/ui/design.ts` (lines 84-100)
```typescript
  /**
   * Tool result indicators (legacy)
   */
  tool: {
    pending: "▶",         // Tool waiting to run
    running: "⣾",         // Tool currently executing (spinner frame)
    success: "[OK]",      // Tool succeeded
    error: "[FAIL]",      // Tool failed
  },

  /**
   * Tool status indicators (new - for collapsible display)
   */
  toolStatus: {
    pending: "·",         // Dot - waiting
    running: "~",         // Tilde - in progress
    success: "✓",         // Checkmark - completed
    error: "✗",           // X - failed
  },
```

#### Steps
1. Open `src/ui/design.ts`
2. Find the `tool:` object in Indicators (~line 84)
3. Add new `toolStatus:` object after it
4. Run build to verify

#### Verification
- [ ] New `Indicators.toolStatus` object exists
- [ ] Contains pending, running, success, error keys
- [ ] Uses ·, ~, ✓, ✗ characters
- [ ] `bun run build` completes without errors

---

### Task 2.2: Create CollapsibleToolBlock Component

**Prerequisites:** Task 2.1
**Dependencies:** None
**Estimated Effort:** Medium (30 minutes)

#### Description
Create a new component that wraps tool display with expand/collapse functionality.

#### Before
**File:** `src/ui/components/CollapsibleToolBlock.tsx`
```
(File does not exist)
```

#### After
**File:** `src/ui/components/CollapsibleToolBlock.tsx` (NEW - ~80 lines)
```typescript
import { createSignal, Show, type JSX } from "solid-js";
import { Colors, Indicators } from "../design";

/**
 * Status display configuration
 */
interface StatusConfig {
  indicator: string;
  color: string;
  autoExpand: boolean;
}

function getStatusConfig(status: string): StatusConfig {
  switch (status) {
    case "success":
      return { 
        indicator: Indicators.toolStatus.success, 
        color: Colors.ui.dim, 
        autoExpand: false 
      };
    case "error":
      return { 
        indicator: Indicators.toolStatus.error, 
        color: Colors.status.error, 
        autoExpand: true 
      };
    case "running":
      return { 
        indicator: Indicators.toolStatus.running, 
        color: Colors.ui.dim, 
        autoExpand: false 
      };
    case "pending":
    default:
      return { 
        indicator: Indicators.toolStatus.pending, 
        color: Colors.ui.dim, 
        autoExpand: false 
      };
  }
}

interface CollapsibleToolBlockProps {
  status: "pending" | "running" | "success" | "error";
  children: JSX.Element;              // Title content (always visible)
  expandedContent?: JSX.Element;      // Content shown when expanded
  defaultExpanded?: boolean;          // Override auto-expand behavior
}

export function CollapsibleToolBlock(props: CollapsibleToolBlockProps) {
  const config = () => getStatusConfig(props.status);
  
  // Initialize expanded state: use defaultExpanded if provided, else auto-expand for errors
  const initialExpanded = () => 
    props.defaultExpanded !== undefined 
      ? props.defaultExpanded 
      : config().autoExpand;
  
  const [expanded, setExpanded] = createSignal(initialExpanded());
  
  // Toggle on click (only if there's content to expand)
  const handleClick = () => {
    if (props.expandedContent) {
      setExpanded(prev => !prev);
    }
  };
  
  const expandIndicator = () => expanded() ? Indicators.expanded : Indicators.collapsed;
  const hasExpandableContent = () => !!props.expandedContent;

  return (
    <box flexDirection="column" paddingLeft={2}>
      {/* Clickable header line */}
      <box 
        flexDirection="row" 
        onMouseUp={handleClick}
      >
        {/* Expand indicator (only show if expandable) */}
        <Show when={hasExpandableContent()} fallback={<text fg={Colors.ui.dim}>  </text>}>
          <text fg={Colors.ui.dim}>{expandIndicator()} </text>
        </Show>
        
        {/* Status indicator */}
        <text fg={config().color}>{config().indicator} </text>
        
        {/* Title content (passed as children) */}
        {props.children}
      </box>
      
      {/* Expanded content */}
      <Show when={expanded() && props.expandedContent}>
        <box paddingLeft={4} flexDirection="column">
          {props.expandedContent}
        </box>
      </Show>
    </box>
  );
}
```

#### Steps
1. Create file `src/ui/components/CollapsibleToolBlock.tsx`
2. Copy the exact content from "After" block above
3. Run build to verify component compiles
4. Export from components index if one exists

#### Verification
- [ ] File exists at `src/ui/components/CollapsibleToolBlock.tsx`
- [ ] Component accepts status, children, expandedContent, defaultExpanded props
- [ ] Click toggles expanded state
- [ ] Errors auto-expand by default
- [ ] `bun run build` completes without errors

---

### Task 2.3: Create DiffView Component

**Prerequisites:** None
**Dependencies:** None
**Estimated Effort:** Medium (25 minutes)

#### Description
Create a component that renders unified diff with colored +/- lines.

#### Before
**File:** `src/ui/components/DiffView.tsx`
```
(File does not exist)
```

#### After
**File:** `src/ui/components/DiffView.tsx` (NEW - ~70 lines)
```typescript
import { For, Show } from "solid-js";
import { Colors } from "../design";

interface DiffViewProps {
  diff: string;           // Unified diff string from createPatch
  maxLines?: number;      // Max changed lines to show (default: 30)
}

interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
}

/**
 * Parse unified diff into typed lines
 */
function parseDiff(diff: string): DiffLine[] {
  const lines = diff.split("\n");
  const result: DiffLine[] = [];
  
  for (const line of lines) {
    // Skip the first 4 header lines (---, +++, and file info)
    if (line.startsWith("---") || line.startsWith("+++")) {
      continue;
    }
    
    // Hunk header (@@)
    if (line.startsWith("@@")) {
      result.push({ type: "header", content: line });
      continue;
    }
    
    // Added line
    if (line.startsWith("+")) {
      result.push({ type: "add", content: line });
      continue;
    }
    
    // Removed line
    if (line.startsWith("-")) {
      result.push({ type: "remove", content: line });
      continue;
    }
    
    // Context line (unchanged)
    if (line.startsWith(" ") || line.length > 0) {
      result.push({ type: "context", content: line });
    }
  }
  
  return result;
}

function getLineColor(type: DiffLine["type"]): string {
  switch (type) {
    case "add": return Colors.diff.addition;
    case "remove": return Colors.diff.deletion;
    case "header": return Colors.ui.dim;
    case "context": return Colors.ui.text;
    default: return Colors.ui.text;
  }
}

export function DiffView(props: DiffViewProps) {
  const maxLines = () => props.maxLines ?? 30;
  const parsedLines = () => parseDiff(props.diff);
  
  // Only count actual changes (not headers or context)
  const changeLines = () => parsedLines().filter(l => l.type === "add" || l.type === "remove");
  const isTruncated = () => changeLines().length > maxLines();
  const displayLines = () => {
    const lines = parsedLines();
    if (!isTruncated()) return lines;
    
    // Take first N changed lines, but include all headers and context around them
    let changeCount = 0;
    const result: DiffLine[] = [];
    
    for (const line of lines) {
      if (line.type === "add" || line.type === "remove") {
        changeCount++;
        if (changeCount > maxLines()) break;
      }
      result.push(line);
    }
    
    return result;
  };
  
  const remainingChanges = () => changeLines().length - maxLines();

  return (
    <box flexDirection="column">
      <For each={displayLines()}>
        {(line) => (
          <text fg={getLineColor(line.type)}>{line.content}</text>
        )}
      </For>
      <Show when={isTruncated()}>
        <text fg={Colors.ui.dim}>... ({remainingChanges()} more changes)</text>
      </Show>
    </box>
  );
}
```

#### Steps
1. Create file `src/ui/components/DiffView.tsx`
2. Copy the exact content from "After" block above
3. Run build to verify component compiles

#### Verification
- [ ] File exists at `src/ui/components/DiffView.tsx`
- [ ] Component parses unified diff format
- [ ] Added lines (+) colored green
- [ ] Removed lines (-) colored red
- [ ] Truncates after maxLines changes
- [ ] `bun run build` completes without errors

---

### Task 2.4: Create Tool-Specific Display Functions

**Prerequisites:** Task 2.2, Task 2.3, Task 1.2
**Dependencies:** None
**Estimated Effort:** Medium (30 minutes)

#### Description
Create helper functions for generating tool-specific title and expanded content.

#### Before
**File:** `src/ui/components/MessageBlock.tsx` - Add after line 275 (after getToolStatusDisplay function)

#### After
**File:** `src/ui/components/MessageBlock.tsx` - New functions (~lines 276-370)
```typescript
// ============================================
// Tool-Specific Display Helpers
// ============================================

import { 
  type ToolMetadata,
  isBashMetadata,
  isFileEditMetadata,
  isFileWriteMetadata,
  isFileReadMetadata,
  isGlobMetadata,
  isGrepMetadata,
  isTaskMetadata,
} from "../../types/tool-metadata";
import { DiffView } from "./DiffView";

/**
 * Generate title text for a tool call based on its metadata
 */
function getToolTitle(name: string, args: string, metadata?: ToolMetadata): string {
  // Use metadata if available
  if (metadata) {
    if (isBashMetadata(metadata)) {
      const desc = metadata.description || metadata.command.slice(0, 40);
      return `bash "${desc.length > 40 ? desc.slice(0, 37) + "..." : desc}"`;
    }
    
    if (isFileWriteMetadata(metadata)) {
      return `file_write ${metadata.filePath} (${metadata.linesWritten} lines)`;
    }
    
    if (isFileEditMetadata(metadata)) {
      return `file_edit ${metadata.filePath} (+${metadata.linesAdded}/-${metadata.linesRemoved})`;
    }
    
    if (isFileReadMetadata(metadata)) {
      const truncStr = metadata.truncated ? ", truncated" : "";
      return `file_read ${metadata.filePath} (${metadata.linesRead} lines${truncStr})`;
    }
    
    if (isGlobMetadata(metadata)) {
      const pathStr = metadata.path ? ` in ${metadata.path}` : "";
      return `glob "${metadata.pattern}"${pathStr} (${metadata.matchCount} matches)`;
    }
    
    if (isGrepMetadata(metadata)) {
      const pathStr = metadata.path ? ` in ${metadata.path}` : "";
      return `grep "${metadata.pattern}"${pathStr} (${metadata.matchCount} matches)`;
    }
    
    if (isTaskMetadata(metadata)) {
      return `task [${metadata.subagentType}] "${metadata.description}"`;
    }
  }
  
  // Fallback: parse from arguments
  try {
    const parsed = JSON.parse(args || "{}");
    
    if (name === "bash") {
      const desc = parsed.description || parsed.command?.slice(0, 40) || "";
      return `bash "${desc}"`;
    }
    
    // Common path-based tools
    const pathKeys = ["path", "filePath", "file"];
    for (const key of pathKeys) {
      if (parsed[key]) {
        const val = String(parsed[key]);
        return `${name} ${val.length > 40 ? val.slice(0, 37) + "..." : val}`;
      }
    }
    
    // Pattern-based tools
    if (parsed.pattern) {
      return `${name} "${parsed.pattern}"`;
    }
    
    // Task tool
    if (name === "task" && parsed.subagent_type) {
      return `task [${parsed.subagent_type}] "${parsed.description || ""}"`;
    }
  } catch {
    // Ignore parse errors
  }
  
  return name;
}

/**
 * Generate expanded content for a tool call based on its metadata
 * Returns null if no expanded content available
 */
function getExpandedContent(
  name: string, 
  metadata?: ToolMetadata, 
  result?: string
): JSX.Element | null {
  if (!metadata) return null;
  
  // Bash: show command and output
  if (isBashMetadata(metadata)) {
    const outputLines = metadata.output.split("\n");
    const previewLines = outputLines.slice(0, 3);
    const hasMore = outputLines.length > 3;
    
    return (
      <box flexDirection="column">
        <text fg={Colors.ui.text}>$ {metadata.command}</text>
        <For each={previewLines}>
          {(line) => <text fg={Colors.ui.dim}>{line}</text>}
        </For>
        <Show when={hasMore}>
          <text fg={Colors.ui.dim}>... ({outputLines.length - 3} more lines)</text>
        </Show>
      </box>
    );
  }
  
  // File Edit: show diff
  if (isFileEditMetadata(metadata) && metadata.diff) {
    return <DiffView diff={metadata.diff} maxLines={30} />;
  }
  
  // Task: show action summaries
  if (isTaskMetadata(metadata) && metadata.actions.length > 0) {
    return (
      <box flexDirection="column">
        <text fg={Colors.ui.dim}>({metadata.toolCallCount} tool calls)</text>
        <For each={metadata.actions}>
          {(action) => (
            <text fg={Colors.ui.dim}>└─ {action}</text>
          )}
        </For>
      </box>
    );
  }
  
  // No expanded content for other tools
  return null;
}
```

**Note:** The import for DiffView needs to be added at the top of the file, and the For/Show imports need to include JSX.Element type.

#### Steps
1. Open `src/ui/components/MessageBlock.tsx`
2. Add import for DiffView at the top (after line 3)
3. Add import for tool metadata types (after line 3)
4. Add the two new functions after the getToolStatusDisplay function
5. Run build to verify

#### Verification
- [ ] `getToolTitle` function generates formatted titles
- [ ] `getExpandedContent` function returns JSX for bash and file_edit
- [ ] Returns null for tools without expanded content
- [ ] `bun run build` completes without errors

---

### Task 2.5: Update ToolCallDisplay to Use New Components

**Prerequisites:** Task 2.2, Task 2.3, Task 2.4
**Dependencies:** None
**Estimated Effort:** Medium (25 minutes)

#### Description
Replace the existing ToolCallDisplay function with one that uses CollapsibleToolBlock.

#### Before
**File:** `src/ui/components/MessageBlock.tsx` (lines 324-396) - Current ToolCallDisplay
```typescript
function ToolCallDisplay(props: { toolCall: ToolCallInfo }) {
  const display = () => getToolStatusDisplay(props.toolCall.status);
  const isTask = () => props.toolCall.name === "task";
  
  // Extract first argument value for context (e.g., filename)
  const argSummary = () => {
    // ... existing implementation
  };
  
  // Extract action summaries from task result (subagent)
  const taskActions = (): string[] => {
    // ... existing implementation
  };
  
  return (
    <box flexDirection="column" paddingLeft={2}>
      {/* Main tool call line */}
      <box flexDirection="row">
        <text fg={display().color}>{display().prefix} </text>
        <text fg={display().color}>{props.toolCall.name}</text>
        <Show when={argSummary()}>
          <text fg={Colors.ui.dim}> {argSummary()}</text>
        </Show>
        <Show when={display().showStatus && display().statusText}>
          <text fg={display().color}> ({display().statusText})</text>
        </Show>
      </box>
      
      {/* Subagent action summaries (indented further) */}
      <Show when={taskActions().length > 0}>
        <For each={taskActions()}>
          {(action) => (
            <box flexDirection="row" paddingLeft={2}>
              <text fg={Colors.ui.dim}>└─ {action}</text>
            </box>
          )}
        </For>
      </Show>
    </box>
  );
}
```

#### After
**File:** `src/ui/components/MessageBlock.tsx` - Replacement ToolCallDisplay
```typescript
/**
 * Render a single tool call with collapsible display
 * - Collapsed: shows status indicator + tool title
 * - Expanded: shows tool-specific content (command output, diff, etc.)
 * - Errors auto-expand
 */
function ToolCallDisplay(props: { toolCall: ToolCallInfo }) {
  const title = () => getToolTitle(
    props.toolCall.name, 
    props.toolCall.arguments, 
    props.toolCall.metadata
  );
  
  const expandedContent = () => getExpandedContent(
    props.toolCall.name,
    props.toolCall.metadata,
    props.toolCall.result
  );
  
  return (
    <CollapsibleToolBlock
      status={props.toolCall.status}
      expandedContent={expandedContent()}
    >
      <text fg={Colors.ui.dim}>{title()}</text>
    </CollapsibleToolBlock>
  );
}
```

#### Steps
1. Open `src/ui/components/MessageBlock.tsx`
2. Add import for CollapsibleToolBlock at the top
3. Replace the entire ToolCallDisplay function with the new implementation
4. Remove the old argSummary and taskActions helper functions (now in getToolTitle/getExpandedContent)
5. Run build to verify

#### Verification
- [ ] CollapsibleToolBlock imported
- [ ] ToolCallDisplay uses CollapsibleToolBlock
- [ ] Title generated using getToolTitle
- [ ] Expanded content generated using getExpandedContent
- [ ] Old argSummary/taskActions functions removed
- [ ] `bun run build` completes without errors

---

### Task 2.6: Export New Components from Index

**Prerequisites:** Task 2.2, Task 2.3
**Dependencies:** None
**Estimated Effort:** Small (5 minutes)

#### Description
Export the new components from the components index file (if it exists).

#### Before
**File:** `src/ui/components/index.ts` (check if exists)

#### After
Add exports for new components:
```typescript
export { CollapsibleToolBlock } from "./CollapsibleToolBlock";
export { DiffView } from "./DiffView";
```

#### Steps
1. Check if `src/ui/components/index.ts` exists
2. If yes, add the export lines
3. If no index file, skip this task (imports will be direct)
4. Run build to verify

#### Verification
- [ ] New components can be imported from index (if index exists)
- [ ] `bun run build` completes without errors

---

## Phase 2 Checkpoint

After completing all Phase 2 tasks:

1. Run `bun run build` - should complete without errors
2. Run `bun run start` - app should start normally
3. Tool calls should display with:
   - ✓/✗/~/· status indicators
   - Formatted titles with metadata
   - Collapsible expanded content
   - Diff view for file_edit
4. Commit: `git add -A && git commit -m "feat(ui): add collapsible tool display with diff view"`

---

## Phase 3: Polish & Looper Integration

> Add error styling, output truncation safety, and looper visibility

---

### Task 3.1: Add Error Styling and Auto-Expand

**Prerequisites:** Phase 2 complete
**Dependencies:** None
**Estimated Effort:** Small (15 minutes)

#### Description
Ensure errors are visually distinct and auto-expanded.

This should already be implemented in CollapsibleToolBlock via `autoExpand: true` for errors, but verify and enhance if needed.

#### Verification Steps
1. Trigger an error (e.g., edit non-existent file)
2. Verify error block auto-expands
3. Verify error has red ✗ indicator
4. Verify error message is visible

#### If Not Working
Check `getStatusConfig` in CollapsibleToolBlock returns `autoExpand: true` for error status.

---

### Task 3.2: Add Output Truncation Safety

**Prerequisites:** Phase 2 complete
**Dependencies:** None
**Estimated Effort:** Small (15 minutes)

#### Description
Add hard limits to prevent massive output from crashing the UI.

#### File: `src/ui/components/MessageBlock.tsx`

Update `getExpandedContent` for bash to add character limit:

```typescript
if (isBashMetadata(metadata)) {
  // Hard limits to prevent UI crash
  const MAX_LINES = 50;
  const MAX_CHARS = 5000;
  
  let output = metadata.output;
  let charTruncated = false;
  
  // Truncate by characters first
  if (output.length > MAX_CHARS) {
    output = output.slice(0, MAX_CHARS);
    charTruncated = true;
  }
  
  const outputLines = output.split("\n");
  const previewLines = outputLines.slice(0, 3);
  const hasMore = outputLines.length > 3 || charTruncated;
  const moreCount = Math.min(outputLines.length - 3, MAX_LINES - 3);
  
  return (
    <box flexDirection="column">
      <text fg={Colors.ui.text}>$ {metadata.command}</text>
      <For each={previewLines}>
        {(line) => <text fg={Colors.ui.dim}>{line}</text>}
      </For>
      <Show when={hasMore}>
        <text fg={Colors.ui.dim}>
          ... ({charTruncated ? "output truncated" : `${moreCount} more lines`})
        </text>
      </Show>
    </box>
  );
}
```

#### Verification
- [ ] Output over 5000 chars is truncated
- [ ] Output over 50 lines is truncated
- [ ] Truncation indicator shows "output truncated" for char limit
- [ ] UI doesn't crash with massive output

---

### Task 3.3: Add Attempt Counter for Looper Visibility

**Prerequisites:** Phase 2 complete
**Dependencies:** None
**Estimated Effort:** Medium (30 minutes)

#### Description
Track and display retry attempts when the same tool is called multiple times for the same task.

**Note:** This is a "Should" priority feature. Implementation requires tracking state across tool calls, which may need a context or store. For MVP, consider a simpler approach:

#### Simple Approach (for MVP)
Add attempt tracking based on consecutive failures of the same tool type:

**File:** `src/ui/components/MessageBlock.tsx`

Add state tracking at the MessageBlock level:

```typescript
// In MessageBlock component, track attempts
const getAttemptCount = (toolCalls: ToolCallInfo[], currentIndex: number): number | null => {
  const current = toolCalls[currentIndex];
  if (!current || current.status !== "error") return null;
  
  // Count consecutive previous failures of same tool
  let attempts = 1;
  for (let i = currentIndex - 1; i >= 0; i--) {
    const prev = toolCalls[i];
    if (prev.name === current.name && prev.status === "error") {
      attempts++;
    } else {
      break;
    }
  }
  
  return attempts > 1 ? attempts : null;
};
```

Then in the tool call rendering:
```typescript
<For each={toolCalls()}>
  {(toolCall, index) => {
    const attempt = getAttemptCount(toolCalls(), index());
    return (
      <ToolCallDisplay 
        toolCall={toolCall} 
        attemptNumber={attempt}
      />
    );
  }}
</For>
```

Update ToolCallDisplay to show attempt:
```typescript
<Show when={props.attemptNumber}>
  <text fg={Colors.status.warning}> (attempt {props.attemptNumber})</text>
</Show>
```

#### Verification
- [ ] Consecutive failures show attempt counter
- [ ] First failure shows no counter
- [ ] Second consecutive failure shows "(attempt 2)"
- [ ] Success resets the counter

---

### Task 3.4: Final Integration Testing

**Prerequisites:** All previous tasks
**Dependencies:** None
**Estimated Effort:** Medium (20 minutes)

#### Description
Comprehensive testing of all tool display features.

#### Test Checklist

**Bash Tool:**
- [ ] Collapsed shows: `▶ ✓ bash "description"`
- [ ] Expanded shows command with $ prefix
- [ ] Expanded shows first 3 lines of output
- [ ] Shows "... (N more lines)" if output > 3 lines
- [ ] Failed bash shows ✗ and auto-expands
- [ ] Exit code shown for non-zero exits

**File Write Tool:**
- [ ] Shows: `✓ file_write path/file.ts (N lines)`
- [ ] Shows "(created)" for new files (if implemented)
- [ ] No expanded content

**File Edit Tool:**
- [ ] Collapsed shows: `▶ ✓ file_edit path/file.ts (+N/-M)`
- [ ] Expanded shows unified diff
- [ ] Added lines colored green
- [ ] Removed lines colored red
- [ ] Long diffs truncated with indicator

**File Read Tool:**
- [ ] Shows: `✓ file_read path/file.ts (N lines)`
- [ ] Shows "truncated" if content was cut
- [ ] No expanded content

**Glob Tool:**
- [ ] Shows: `✓ glob "pattern" (N matches)`
- [ ] Shows path if specified
- [ ] No expanded content

**Grep Tool:**
- [ ] Shows: `✓ grep "pattern" (N matches)`
- [ ] Shows path if specified
- [ ] No expanded content

**Task (Subagent) Tool:**
- [ ] Collapsed shows: `▶ ✓ task [type] "description"`
- [ ] Expanded shows tool call count
- [ ] Expanded shows action summaries

**Error Handling:**
- [ ] Errors auto-expand
- [ ] Errors show ✗ in red
- [ ] Error message visible in expanded view

**Looper Integration:**
- [ ] Consecutive failures show attempt counter
- [ ] Attempt counter format: "(attempt N)"

---

## Phase 3 Checkpoint

After completing all Phase 3 tasks:

1. Run `bun run build` - should complete without errors
2. Run full test checklist above
3. Commit: `git add -A && git commit -m "feat(ui): add error styling, truncation safety, looper visibility"`

---

## Final Commit and Version Bump

After all phases complete:

1. Update CHANGELOG.md with new features
2. Bump version: `bun version minor` (this is a feature addition)
3. Update AGENTS.md version
4. Final commit: `git add -A && git commit -m "feat: tool display refactor with collapsible blocks, diffs, looper visibility"`
5. Tag: `git tag -a vX.Y.0 -m "Release vX.Y.0 - Tool Display Refactor"`

---

## Context Recovery Notes

If resuming this work after compaction:

1. **Read this document first** - It has all the context
2. **Check git log** - See which tasks were completed
3. **Check git status** - See if there's work in progress
4. **Run `bun run build`** - Verify current state compiles

### Key Files to Review
- `src/types/tool-metadata.ts` - Type definitions
- `src/ui/components/MessageBlock.tsx` - Main display logic
- `src/ui/components/CollapsibleToolBlock.tsx` - Collapse component
- `src/ui/components/DiffView.tsx` - Diff renderer
- `src/tools/*.ts` - Tool implementations with metadata

### Design References
- Requirements: `docs/feature-tool-display/Requirements.md`
- Design: `docs/feature-tool-display/Design.md`
- Looper skill: `.opencode/skills/looper/SKILL.md`
