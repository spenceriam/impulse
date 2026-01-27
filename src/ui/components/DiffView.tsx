import { createMemo } from "solid-js";
import { Colors } from "../design";

interface DiffViewProps {
  diff: string;           // Unified diff string from createPatch
  maxLines?: number;      // Max changed lines to show (default: 30) - not used with native diff
  isNewFile?: boolean;    // True for new file creations (all lines are additions)
}

/**
 * Count additions and deletions from a unified diff string
 */
function countChanges(diff: string): { additions: number; deletions: number } {
  const lines = diff.split("\n");
  let additions = 0;
  let deletions = 0;
  
  for (const line of lines) {
    // Skip file headers
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    // Skip hunk headers
    if (line.startsWith("@@")) continue;
    
    if (line.startsWith("+")) {
      additions++;
    } else if (line.startsWith("-")) {
      deletions++;
    }
  }
  
  return { additions, deletions };
}

/**
 * DiffView Component
 * 
 * Uses OpenTUI's native <diff> component for side-by-side diff display.
 * 
 * For file_write (new files): Shows content on LEFT side (new file), RIGHT empty
 * For file_edit: Shows original on LEFT, modified on RIGHT
 * 
 * Props:
 * - diff: Unified diff string from createPatch()
 * - isNewFile: If true, shows as new file creation
 */
export function DiffView(props: DiffViewProps) {
  const changes = createMemo(() => countChanges(props.diff));
  
  // For new files, we want content on the LEFT (original side is empty)
  // The diff library creates patches with all lines as additions (+)
  // which normally shows on the right. We need to invert for new files.
  const displayDiff = createMemo(() => {
    if (!props.isNewFile) {
      return props.diff;
    }
    
    // For new files, invert the diff so content appears on LEFT
    // Change +lines to -lines (so they appear in the "old" column which is left)
    const lines = props.diff.split("\n");
    const inverted = lines.map(line => {
      // Swap file headers
      if (line.startsWith("--- ")) return line.replace("--- ", "+++ ");
      if (line.startsWith("+++ ")) return line.replace("+++ ", "--- ");
      // Swap hunk header numbers (invert old/new positions)
      if (line.startsWith("@@")) {
        // @@ -0,0 +1,5 @@ becomes @@ -1,5 +0,0 @@
        return line.replace(/@@ -(\d+),(\d+) \+(\d+),(\d+) @@/, "@@ -$3,$4 +$1,$2 @@");
      }
      // Swap + to - (so additions show on left "removed" side)
      if (line.startsWith("+") && !line.startsWith("+++")) {
        return "-" + line.slice(1);
      }
      return line;
    });
    return inverted.join("\n");
  });

  return (
    <box flexDirection="column">
      {/* Diff view using native OpenTUI component */}
      <diff
        diff={displayDiff()}
        view="split"
        showLineNumbers={true}
        wrapMode="word"
        fg={Colors.ui.text}
        addedBg="#1a2f1a"
        removedBg="#2f1a1a"
        contextBg="#141414"
        addedSignColor={Colors.diff.addition}
        removedSignColor={Colors.diff.deletion}
        lineNumberFg={Colors.ui.dim}
        lineNumberBg="#0a0a0a"
        addedLineNumberBg="#1a2f1a"
        removedLineNumberBg="#2f1a1a"
      />
      
      {/* Summary footer: +X / -Y */}
      <box flexDirection="row" justifyContent="flex-end" marginTop={1}>
        <text fg={Colors.diff.addition}>+{changes().additions}</text>
        <text fg={Colors.ui.dim}> / </text>
        <text fg={Colors.diff.deletion}>-{changes().deletions}</text>
      </box>
    </box>
  );
}
