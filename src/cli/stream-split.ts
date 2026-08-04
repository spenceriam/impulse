/**
 * Split a streaming Markdown buffer only at boundaries that remain valid when
 * the frozen prefix and mutable remainder render as separate TUI blocks.
 */

import { isTableLikeLine } from "./markdown-table.js";

export type StreamSplitKind = "paragraph" | "line";

export interface StreamSplit {
  frozen: string;
  remainder: string;
  kind: StreamSplitKind;
}

export interface StreamSplitOptions {
  allowLineCut?: boolean;
}

export interface StreamingRotationInput {
  raw: string;
  incomingToken: string;
  renderedLines: number;
  softLimit: number;
  hardLimit: number;
}

export interface StreamingRotationPlan {
  split: StreamSplit | null;
  nextRaw: string;
}

const FENCE_RE = /^\s*(```|~~~)/;

function computeFenceState(lines: string[]): { before: boolean[]; after: boolean[] } {
  const before: boolean[] = [];
  const after: boolean[] = [];
  let inFence = false;

  for (const line of lines) {
    before.push(inFence);
    if (FENCE_RE.test(line)) inFence = !inFence;
    after.push(inFence);
  }

  return { before, after };
}

function findParagraphBoundary(
  lines: string[],
  inFenceBefore: boolean[]
): { frozenEnd: number; remainderStart: number } | null {
  let index = lines.length - 1;

  while (index >= 0) {
    if ((lines[index] ?? "").trim().length === 0 && !inFenceBefore[index]) {
      const runEndExclusive = index + 1;
      let runStart = index;
      while (
        runStart > 0 &&
        (lines[runStart - 1] ?? "").trim().length === 0 &&
        !inFenceBefore[runStart - 1]
      ) {
        runStart -= 1;
      }

      if (lines.slice(0, runStart).join("\n").trim().length > 0) {
        return { frozenEnd: runStart, remainderStart: runEndExclusive };
      }
      index = runStart - 1;
      continue;
    }
    index -= 1;
  }

  return null;
}

function findLineBoundary(
  lines: string[],
  inFenceAfter: boolean[]
): { frozenEnd: number; remainderStart: number } | null {
  for (let index = lines.length - 2; index >= 0; index -= 1) {
    if (inFenceAfter[index]) continue;
    const left = lines[index] ?? "";
    const right = lines[index + 1] ?? "";
    if (isTableLikeLine(left) || isTableLikeLine(right)) continue;
    if (lines.slice(0, index + 1).join("\n").trim().length === 0) continue;
    return { frozenEnd: index + 1, remainderStart: index + 1 };
  }

  return null;
}

export function splitAtSafeBoundary(
  raw: string,
  options?: StreamSplitOptions
): StreamSplit | null {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const fenceState = computeFenceState(lines);

  const paragraph = findParagraphBoundary(lines, fenceState.before);
  if (paragraph) {
    return {
      frozen: lines.slice(0, paragraph.frozenEnd).join("\n"),
      remainder: lines.slice(paragraph.remainderStart).join("\n"),
      kind: "paragraph",
    };
  }

  if (options?.allowLineCut) {
    const line = findLineBoundary(lines, fenceState.after);
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

/** Plan the exact pre-token rotation used by the live TUI stream. */
export function planStreamingRotation(
  input: StreamingRotationInput
): StreamingRotationPlan {
  const atSoftLimit = input.renderedLines >= input.softLimit;
  const atHardLimit = input.renderedLines >= input.hardLimit;
  let split = atSoftLimit
    ? splitAtSafeBoundary(input.raw, {
        allowLineCut: atHardLimit,
      })
    : null;

  // When line limits are exceeded but no Markdown-safe boundary exists (e.g. one
  // long wrapped line), force-rotate the whole buffer like the prior line-count path.
  if (atSoftLimit && !split && input.raw.trim().length > 0) {
    if (atHardLimit || !input.raw.includes("\n")) {
      split = {
        frozen: input.raw,
        remainder: "",
        kind: "line",
      };
    }
  }

  const mutableRaw = split?.remainder ?? input.raw;
  return {
    split,
    nextRaw: `${mutableRaw}${input.incomingToken}`,
  };
}
