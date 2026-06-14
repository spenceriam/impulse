import { diffLines } from "diff";

export interface CompactDiffOptions {
  /** Number of unchanged context lines to keep around each change. */
  contextLines?: number;
}

export interface CompactDiffResult {
  /** Pi-style compact diff lines: marker + padded line number + content. */
  lines: string[];
  additions: number;
  removals: number;
  firstChangedLine?: number;
}

const DEFAULT_CONTEXT_LINES = 2;

/** Hard input safety valve: skip diffing entirely above this (pathological files). */
export const MAX_DIFF_INPUT_BYTES = 2_000_000;

/** Max compactDiff lines stored in tool metadata; excess is truncated. */
export const MAX_COMPACT_DIFF_LINES = 200;

/** Legacy unified patch gate — UI prefers compactDiff. */
export const MAX_DIFF_PATCH_BYTES = 200_000;

export interface CappedCompactDiff {
  compactDiff: string[];
  linesAdded: number;
  linesRemoved: number;
  firstChangedLine?: number;
  diffTruncatedLines?: number;
}

/** Store compact diff lines with a metadata cap; counts reflect the full change. */
export function capCompactDiffResult(compact: CompactDiffResult): CappedCompactDiff {
  const base: Pick<CappedCompactDiff, "linesAdded" | "linesRemoved"> & {
    firstChangedLine?: number;
  } = {
    linesAdded: compact.additions,
    linesRemoved: compact.removals,
  };
  if (compact.firstChangedLine !== undefined) {
    base.firstChangedLine = compact.firstChangedLine;
  }
  if (compact.lines.length <= MAX_COMPACT_DIFF_LINES) {
    return { compactDiff: compact.lines, ...base };
  }
  return {
    compactDiff: compact.lines.slice(0, MAX_COMPACT_DIFF_LINES),
    diffTruncatedLines: compact.lines.length - MAX_COMPACT_DIFF_LINES,
    ...base,
  };
}

function normalizeToLf(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function splitRenderableLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function lineNumberWidth(oldContent: string, newContent: string): number {
  const oldCount = Math.max(1, oldContent.split("\n").length);
  const newCount = Math.max(1, newContent.split("\n").length);
  return String(Math.max(oldCount, newCount)).length;
}

function formatDiffLine(prefix: "+" | "-" | " ", lineNumber: number | undefined, width: number, content: string): string {
  const renderedLineNumber = lineNumber === undefined ? "".padStart(width, " ") : String(lineNumber).padStart(width, " ");
  return `${prefix}${renderedLineNumber} ${content}`;
}

/**
 * Create a compact, terminal-friendly diff similar to Pi's edit renderer.
 *
 * The output deliberately omits patch headers and hunk markers. Each line starts
 * with a marker (`+`, `-`, or space), a padded line number, then content.
 */
export function createCompactDiff(
  oldContent: string,
  newContent: string,
  options: CompactDiffOptions = {},
): CompactDiffResult {
  const contextLines = options.contextLines ?? DEFAULT_CONTEXT_LINES;
  const oldNormalized = normalizeToLf(oldContent);
  const newNormalized = normalizeToLf(newContent);
  const parts = diffLines(oldNormalized, newNormalized);
  const width = lineNumberWidth(oldNormalized, newNormalized);

  const lines: string[] = [];
  let additions = 0;
  let removals = 0;
  let oldLineNumber = 1;
  let newLineNumber = 1;
  let lastWasChange = false;
  let firstChangedLine: number | undefined;

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) continue;

    const rawLines = splitRenderableLines(part.value);

    if (part.added || part.removed) {
      if (firstChangedLine === undefined) {
        firstChangedLine = newLineNumber;
      }

      for (const line of rawLines) {
        if (part.added) {
          lines.push(formatDiffLine("+", newLineNumber, width, line));
          newLineNumber += 1;
          additions += 1;
        } else {
          lines.push(formatDiffLine("-", oldLineNumber, width, line));
          oldLineNumber += 1;
          removals += 1;
        }
      }

      lastWasChange = true;
      continue;
    }

    const nextPart = parts[index + 1];
    const nextPartIsChange = Boolean(nextPart?.added || nextPart?.removed);
    const hasLeadingChange = lastWasChange;
    const hasTrailingChange = nextPartIsChange;

    if (hasLeadingChange && hasTrailingChange) {
      if (rawLines.length <= contextLines * 2) {
        for (const line of rawLines) {
          lines.push(formatDiffLine(" ", oldLineNumber, width, line));
          oldLineNumber += 1;
          newLineNumber += 1;
        }
      } else {
        const leadingLines = rawLines.slice(0, contextLines);
        const trailingLines = rawLines.slice(rawLines.length - contextLines);
        const skippedLines = rawLines.length - leadingLines.length - trailingLines.length;

        for (const line of leadingLines) {
          lines.push(formatDiffLine(" ", oldLineNumber, width, line));
          oldLineNumber += 1;
          newLineNumber += 1;
        }

        lines.push(formatDiffLine(" ", undefined, width, "…"));
        oldLineNumber += skippedLines;
        newLineNumber += skippedLines;

        for (const line of trailingLines) {
          lines.push(formatDiffLine(" ", oldLineNumber, width, line));
          oldLineNumber += 1;
          newLineNumber += 1;
        }
      }
    } else if (hasLeadingChange) {
      const shownLines = rawLines.slice(0, contextLines);
      const skippedLines = rawLines.length - shownLines.length;

      for (const line of shownLines) {
        lines.push(formatDiffLine(" ", oldLineNumber, width, line));
        oldLineNumber += 1;
        newLineNumber += 1;
      }

      if (skippedLines > 0) {
        lines.push(formatDiffLine(" ", undefined, width, "…"));
        oldLineNumber += skippedLines;
        newLineNumber += skippedLines;
      }
    } else if (hasTrailingChange) {
      const skippedLines = Math.max(0, rawLines.length - contextLines);

      if (skippedLines > 0) {
        lines.push(formatDiffLine(" ", undefined, width, "…"));
        oldLineNumber += skippedLines;
        newLineNumber += skippedLines;
      }

      for (const line of rawLines.slice(skippedLines)) {
        lines.push(formatDiffLine(" ", oldLineNumber, width, line));
        oldLineNumber += 1;
        newLineNumber += 1;
      }
    } else {
      oldLineNumber += rawLines.length;
      newLineNumber += rawLines.length;
    }

    lastWasChange = false;
  }

  return firstChangedLine === undefined
    ? { lines, additions, removals }
    : { lines, additions, removals, firstChangedLine };
}

/** Create compact `+` lines for a newly-created file. */
export function createAddedFileCompactDiff(content: string): CompactDiffResult {
  const normalized = normalizeToLf(content);
  const contentLines = splitRenderableLines(normalized);
  const width = String(Math.max(1, contentLines.length)).length;
  const lines = contentLines.map((line, index) => formatDiffLine("+", index + 1, width, line));

  return contentLines.length > 0
    ? { lines, additions: contentLines.length, removals: 0, firstChangedLine: 1 }
    : { lines, additions: 0, removals: 0 };
}
