/**
 * String matching helpers for file_edit — exact match with whitespace-normalized fallback.
 */

export type EditMatchResult = {
  effectiveOldString: string;
  startIndex: number;
  endIndex: number;
  usedFallback: boolean;
};

function splitLines(text: string): string[] {
  return text.split("\n");
}

function lineCharIndex(lines: string[], lineIndex: number): number {
  let idx = 0;
  for (let i = 0; i < lineIndex; i++) {
    idx += lines[i]!.length + 1;
  }
  return idx;
}

function matchWindowAt(
  contentLines: string[],
  startLine: number,
  oldLines: string[]
): boolean {
  if (startLine + oldLines.length > contentLines.length) return false;
  for (let j = 0; j < oldLines.length; j++) {
    if (contentLines[startLine + j]!.trim() !== oldLines[j]!.trim()) {
      return false;
    }
  }
  return true;
}

function buildMatchFromWindow(
  contentLines: string[],
  startLine: number,
  oldLines: string[]
): EditMatchResult {
  const effectiveOldString = contentLines
    .slice(startLine, startLine + oldLines.length)
    .join("\n");
  const startIndex = lineCharIndex(contentLines, startLine);
  return {
    effectiveOldString,
    startIndex,
    endIndex: startIndex + effectiveOldString.length,
    usedFallback: true,
  };
}

/** Exact substring match (current file_edit behavior). */
export function findExact(content: string, oldString: string): EditMatchResult | null {
  const index = content.indexOf(oldString);
  if (index === -1) return null;
  return {
    effectiveOldString: oldString,
    startIndex: index,
    endIndex: index + oldString.length,
    usedFallback: false,
  };
}

/** Count non-overlapping exact occurrences. */
export function countExactOccurrences(content: string, oldString: string): number {
  if (!oldString) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const index = content.indexOf(oldString, from);
    if (index === -1) break;
    count++;
    from = index + oldString.length;
  }
  return count;
}

/** Greedy left-to-right selection of non-overlapping matches. */
export function filterNonOverlappingMatches(matches: EditMatchResult[]): EditMatchResult[] {
  if (matches.length <= 1) return matches;

  const sorted = [...matches].sort((a, b) => a.startIndex - b.startIndex);
  const selected: EditMatchResult[] = [];
  let lastEnd = -1;

  for (const match of sorted) {
    if (match.startIndex < lastEnd) continue;
    selected.push(match);
    lastEnd = match.endIndex;
  }

  return selected;
}

/** Find all line-trimmed windows matching oldString. */
export function findAllLineTrimmed(content: string, oldString: string): EditMatchResult[] {
  const oldLines = splitLines(oldString);
  if (oldLines.length === 0) return [];

  const contentLines = splitLines(content);
  const matches: EditMatchResult[] = [];

  for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
    if (!matchWindowAt(contentLines, i, oldLines)) continue;
    matches.push(buildMatchFromWindow(contentLines, i, oldLines));
  }

  return matches;
}

/**
 * Line-trimmed fallback — unique match only.
 * Re-derives exact file text (preserving indentation) from the matched window.
 */
export function findLineTrimmed(content: string, oldString: string): EditMatchResult | null {
  const matches = findAllLineTrimmed(content, oldString);
  if (matches.length !== 1) return null;
  return matches[0] ?? null;
}

/** Apply a single replacement at match boundaries. */
export function applyReplacement(
  content: string,
  match: EditMatchResult,
  newString: string
): string {
  return (
    content.substring(0, match.startIndex) +
    newString +
    content.substring(match.endIndex)
  );
}

/** Replace all exact occurrences of oldString in content. */
export function replaceAllExact(content: string, oldString: string, newString: string): string {
  return content.split(oldString).join(newString);
}

/**
 * Replace all line-trimmed windows. Applies replacements from end to start so indices stay valid.
 */
export function replaceAllLineTrimmed(
  content: string,
  oldString: string,
  newString: string
): string {
  const matches = filterNonOverlappingMatches(findAllLineTrimmed(content, oldString));
  if (matches.length === 0) return content;

  let result = content;
  const sorted = [...matches].sort((a, b) => b.startIndex - a.startIndex);
  for (const match of sorted) {
    result = applyReplacement(result, match, newString);
  }
  return result;
}

/** Build a model-readable error when oldString cannot be matched. */
export function buildOldStringNotFoundError(
  filePath: string,
  content: string,
  oldString: string
): string {
  const oldLines = splitLines(oldString);
  const contentLines = splitLines(content);

  const firstNonEmpty = oldLines.findIndex((line) => line.trim().length > 0);
  if (firstNonEmpty === -1) {
    return `oldString not found in file: ${filePath}`;
  }

  const needle = oldLines[firstNonEmpty]!.trim();
  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i]!.trim() !== needle) continue;
    const lineNum = i + 1;
    return `oldString not found in ${filePath}. Closest match at line ${lineNum} has different indentation/whitespace — re-read the file and copy the exact text including leading spaces.`;
  }

  return `oldString not found in file: ${filePath}`;
}

export type ResolveEditMatchOptions = {
  replaceAll?: boolean;
};

export type ResolvedEditMatch = {
  effectiveOldString: string;
  usedFallback: boolean;
  occurrences: number;
};

/**
 * Resolve the effective oldString for an edit — exact first, then trimmed fallback.
 */
export function resolveEditMatch(
  content: string,
  oldString: string,
  options: ResolveEditMatchOptions = {}
): ResolvedEditMatch | null {
  const exact = findExact(content, oldString);
  if (exact) {
    return {
      effectiveOldString: exact.effectiveOldString,
      usedFallback: false,
      occurrences: countExactOccurrences(content, exact.effectiveOldString),
    };
  }

  const trimmedMatches = findAllLineTrimmed(content, oldString);
  if (trimmedMatches.length === 0) return null;

  const nonOverlapping = filterNonOverlappingMatches(trimmedMatches);

  if (options.replaceAll) {
    return {
      effectiveOldString: nonOverlapping[0]!.effectiveOldString,
      usedFallback: true,
      occurrences: nonOverlapping.length,
    };
  }

  if (nonOverlapping.length !== 1) return null;

  const match = nonOverlapping[0]!;
  return {
    effectiveOldString: match.effectiveOldString,
    usedFallback: true,
    occurrences: 1,
  };
}
