import { createMemo, Show, For } from "solid-js";
import { Colors } from "../design";

interface DiffViewProps {
  diff: string;           // Unified diff string from createPatch
  maxLines?: number;      // Max lines to show (default: 30)
  isNewFile?: boolean;    // True for new file creations (shows plain content, no diff)
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
 * Extract plain content lines from a unified diff (strips +/- markers and headers)
 */
function extractContentLines(diff: string): string[] {
  return diff.split("\n")
    .filter(line => 
      !line.startsWith("---") && 
      !line.startsWith("+++") && 
      !line.startsWith("@@") &&
      !line.startsWith("\\ No newline")
    )
    .map(line => {
      // Strip the leading +/- marker
      if (line.startsWith("+") || line.startsWith("-")) {
        return line.slice(1);
      }
      // Context lines (space prefix)
      if (line.startsWith(" ")) {
        return line.slice(1);
      }
      return line;
    });
}

/**
 * DiffView Component
 * 
 * For file_write (new files): Shows plain content with line numbers (no diff shading)
 * For file_edit: Shows side-by-side diff with +/- shading
 * 
 * Props:
 * - diff: Unified diff string from createPatch()
 * - isNewFile: If true, shows plain content (no diff formatting)
 * - maxLines: Max lines to display (default: 30)
 */
export function DiffView(props: DiffViewProps) {
  const changes = createMemo(() => countChanges(props.diff));
  const maxLines = () => props.maxLines ?? 30;
  
  // For new files, extract plain content (no diff markers)
  const contentLines = createMemo(() => {
    const lines = extractContentLines(props.diff);
    return lines.slice(0, maxLines());
  });
  
  const totalLines = createMemo(() => extractContentLines(props.diff).length);
  const isTruncated = createMemo(() => totalLines() > maxLines());

  // New file: show plain code with line numbers (no diff shading)
  if (props.isNewFile) {
    return (
      <box flexDirection="column">
        <box flexDirection="column" backgroundColor="#141414" paddingLeft={1} paddingRight={1}>
          <For each={contentLines()}>
            {(line, index) => (
              <box flexDirection="row">
                <text fg={Colors.ui.dim} width={4}>{String(index() + 1).padStart(3, " ")} </text>
                <text fg={Colors.ui.text}>{line}</text>
              </box>
            )}
          </For>
        </box>
        
        {/* Footer: line count */}
        <box flexDirection="row" justifyContent="flex-end" marginTop={1}>
          <text fg={Colors.ui.dim}>{totalLines()} lines</text>
          <Show when={isTruncated()}>
            <text fg={Colors.ui.dim}> (showing {maxLines()})</text>
          </Show>
        </box>
      </box>
    );
  }

  // File edit: show full diff with shading
  return (
    <box flexDirection="column">
      <diff
        diff={props.diff}
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
