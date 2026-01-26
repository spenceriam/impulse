import { For, Show } from "solid-js";
import { Colors } from "../design";

interface DiffViewProps {
  diff: string;           // Unified diff string from createPatch
  maxLines?: number;      // Max changed lines to show (default: 30)
  isNewFile?: boolean;    // True for new file creations (all lines are additions)
}

interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;        // Content without the +/- prefix
  rawContent: string;     // Original line with prefix
  oldLineNum?: number;    // Line number in old file (undefined for additions)
  newLineNum?: number;    // Line number in new file (undefined for deletions)
}

/**
 * Parse hunk header to extract line numbers
 * Format: @@ -oldStart,oldCount +newStart,newCount @@
 * Example: @@ -10,5 +10,7 @@ function name
 */
function parseHunkHeader(line: string): { oldStart: number; newStart: number } | null {
  const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (match && match[1] && match[2]) {
    return {
      oldStart: parseInt(match[1], 10),
      newStart: parseInt(match[2], 10),
    };
  }
  return null;
}

/**
 * Parse unified diff into typed lines with line numbers
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
  
  let oldLine = 1;
  let newLine = 1;

  for (const line of lines) {
    // Skip file header lines (--- a/file, +++ b/file)
    if (line.startsWith("---") || line.startsWith("+++")) {
      continue;
    }

    // Hunk header (@@) - extract starting line numbers
    if (line.startsWith("@@")) {
      const parsed = parseHunkHeader(line);
      if (parsed) {
        oldLine = parsed.oldStart;
        newLine = parsed.newStart;
      }
      result.push({ type: "header", content: line, rawContent: line });
      continue;
    }

    // Added line - only has new line number
    if (line.startsWith("+")) {
      result.push({ 
        type: "add", 
        content: line.slice(1),  // Remove + prefix
        rawContent: line,
        newLineNum: newLine,
      });
      newLine++;
      continue;
    }

    // Removed line - only has old line number
    if (line.startsWith("-")) {
      result.push({ 
        type: "remove", 
        content: line.slice(1),  // Remove - prefix
        rawContent: line,
        oldLineNum: oldLine,
      });
      oldLine++;
      continue;
    }

    // Context line (unchanged) - has both line numbers
    if (line.startsWith(" ") || line.length > 0) {
      result.push({ 
        type: "context", 
        content: line.startsWith(" ") ? line.slice(1) : line,  // Remove leading space if present
        rawContent: line,
        oldLineNum: oldLine,
        newLineNum: newLine,
      });
      oldLine++;
      newLine++;
    }
  }

  return result;
}

/**
 * Format line number with padding
 * Returns empty string for undefined (no line number for that side)
 */
function formatLineNum(num: number | undefined, width: number): string {
  if (num === undefined) return " ".repeat(width);
  return String(num).padStart(width, " ");
}

/**
 * Get the width needed for line numbers based on max line
 */
function getLineNumWidth(lines: DiffLine[]): number {
  let maxLine = 1;
  for (const line of lines) {
    if (line.oldLineNum && line.oldLineNum > maxLine) maxLine = line.oldLineNum;
    if (line.newLineNum && line.newLineNum > maxLine) maxLine = line.newLineNum;
  }
  return Math.max(3, String(maxLine).length);  // Minimum 3 chars
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

function getIndicator(type: DiffLine["type"]): string {
  switch (type) {
    case "add": return "+";
    case "remove": return "-";
    case "context": return " ";
    case "header": return " ";
    default: return " ";
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

  const lineNumWidth = () => getLineNumWidth(displayLines());
  const remainingChanges = () => changeLines().length - maxLines();

  // For new files, simplified display (only new line numbers)
  const isNewFile = () => props.isNewFile ?? false;

  return (
    <box flexDirection="column">
      <For each={displayLines()}>
        {(line) => {
          // Skip rendering header lines with line numbers (they're metadata)
          if (line.type === "header") {
            return <text fg={Colors.ui.dim}>{line.rawContent}</text>;
          }
          
          const width = lineNumWidth();
          const oldNum = formatLineNum(line.oldLineNum, width);
          const newNum = formatLineNum(line.newLineNum, width);
          const indicator = getIndicator(line.type);
          const color = getLineColor(line.type);
          
          // Format: "oldNum | newNum | indicator content"
          // For new files: "   | newNum | + content"
          if (isNewFile()) {
            return (
              <box flexDirection="row">
                <text fg={Colors.ui.dim}>{`${newNum} `}</text>
                <text fg={color}>{indicator}</text>
                <text fg={color}>{` ${line.content}`}</text>
              </box>
            );
          }
          
          return (
            <box flexDirection="row">
              <text fg={Colors.ui.dim}>{`${oldNum} `}</text>
              <text fg={Colors.ui.dim}>{`${newNum} `}</text>
              <text fg={color}>{indicator}</text>
              <text fg={color}>{` ${line.content}`}</text>
            </box>
          );
        }}
      </For>
      <Show when={isTruncated()}>
        <text fg={Colors.ui.dim}>... ({remainingChanges()} more changes)</text>
      </Show>
    </box>
  );
}
