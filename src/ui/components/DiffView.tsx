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
 * 
 * Unified diff format:
 * - Lines starting with "---" or "+++" are file headers (skipped)
 * - Lines starting with "@@" are hunk headers (line range info)
 * - Lines starting with "+" are additions (green)
 * - Lines starting with "-" are deletions (red)
 * - Lines starting with " " or other content are context (unchanged)
 */
function parseDiff(diff: string): DiffLine[] {
  const lines = diff.split("\n");
  const result: DiffLine[] = [];

  for (const line of lines) {
    // Skip file header lines (--- a/file, +++ b/file)
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
