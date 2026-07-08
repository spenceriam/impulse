/**
 * Pure helper for splitting a streaming markdown buffer at a safe boundary.
 *
 * Used by the renderer to rotate the mutable streaming block without cutting
 * mid-sentence, mid-heading, mid-table, or mid-code-fence (see issue #127).
 */

import { isTableLikeLine } from "./markdown-table.js";

export type StreamSplitKind = "paragraph" | "line";

export interface StreamSplit {
  /** Clean prefix to freeze into the old block. */
  frozen: string;
  /** Becomes the new streamingRaw (may be empty). */
  remainder: string;
  kind: StreamSplitKind;
}

export interface StreamSplitOptions {
  /** Allow falling back to a last-safe-line cut when no paragraph boundary exists yet. */
  allowLineCut?: boolean;
}

const FENCE_RE = /^\s*(```|~~~)/;

function isBlankLine(line: string): boolean {
  return line.trim().length === 0;
}

/** before[i]/after[i]: whether we're inside an unclosed fence before/after line i. */
function computeFenceState(lines: string[]): { before: boolean[]; after: boolean[] } {
  const before: boolean[] = [];
  const after: boolean[] = [];
  let fence = false;
  for (const line of lines) {
    before.push(fence);
    if (FENCE_RE.test(line)) {
      fence = !fence;
    }
    after.push(fence);
  }
  return { before, after };
}

interface BoundaryIndices {
  frozenEnd: number;
  remainderStart: number;
}

/** Last maximal blank-line run outside a fence, with non-blank content before it. */
function findParagraphBoundary(lines: string[], inFenceBefore: boolean[]): BoundaryIndices | null {
  let i = lines.length - 1;
  while (i >= 0) {
    const line = lines[i] ?? "";
    if (isBlankLine(line) && !inFenceBefore[i]) {
      const runEndExclusive = i + 1;
      let runStart = i;
      while (
        runStart - 1 >= 0 &&
        isBlankLine(lines[runStart - 1] ?? "") &&
        !inFenceBefore[runStart - 1]
      ) {
        runStart -= 1;
      }
      const before = lines.slice(0, runStart).join("\n");
      if (before.trim().length > 0) {
        return { frozenEnd: runStart, remainderStart: runEndExclusive };
      }
      i = runStart - 1;
      continue;
    }
    i -= 1;
  }
  return null;
}

/** Last inter-line position with no unclosed fence and no table-like neighbor. */
function findLineBoundary(lines: string[], inFenceAfter: boolean[]): BoundaryIndices | null {
  for (let j = lines.length - 2; j >= 0; j -= 1) {
    if (inFenceAfter[j]) continue;
    const left = lines[j] ?? "";
    const right = lines[j + 1] ?? "";
    if (isTableLikeLine(left) || isTableLikeLine(right)) continue;
    const before = lines.slice(0, j + 1).join("\n");
    if (before.trim().length === 0) continue;
    return { frozenEnd: j + 1, remainderStart: j + 1 };
  }
  return null;
}

export function splitAtSafeBoundary(raw: string, options?: StreamSplitOptions): StreamSplit | null {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const { before, after } = computeFenceState(lines);

  const paragraph = findParagraphBoundary(lines, before);
  if (paragraph) {
    return {
      frozen: lines.slice(0, paragraph.frozenEnd).join("\n"),
      remainder: lines.slice(paragraph.remainderStart).join("\n"),
      kind: "paragraph",
    };
  }

  if (options?.allowLineCut) {
    const line = findLineBoundary(lines, after);
    if (line) {
      return {
        frozen: lines.slice(0, line.frozenEnd).join("\n"),
        remainder: lines.slice(line.remainderStart).join("\n"),
        kind: "line",
      };
    }
  }

  return null;
}
