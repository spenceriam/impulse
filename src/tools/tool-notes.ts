/**
 * Relational invariant feedback — transparent `Note:` messages when tools apply
 * sensible defaults. Not errors; prepended to successful tool output.
 */

export const FILE_READ_DEFAULT_LIMIT = 2000;
export const WEB_FETCH_DEFAULT_MAX_CHARS = 12000;
export const WEB_SEARCH_DEFAULT_MAX_RESULTS = 5;

export function prependToolNote(output: string, note: string | null): string {
  if (!note) return output;
  return `${note}\n${output}`;
}

export function buildFileReadRangeNote(input: {
  offset?: number | undefined;
  limit?: number | undefined;
}): string | null {
  const hasOffset = input.offset !== undefined;
  const hasLimit = input.limit !== undefined;

  if (hasOffset && !hasLimit) {
    return `Note: limit was not provided, so it defaulted to ${FILE_READ_DEFAULT_LIMIT} lines. You can retry with both offset and limit if you need a different range.`;
  }
  if (hasLimit && !hasOffset) {
    return `Note: offset was not provided, so it defaulted to 0. You can retry with both offset and limit if you need a different range.`;
  }
  return null;
}

export function buildGlobPathNote(input: { path?: string | undefined }, cwd: string): string | null {
  if (input.path !== undefined) return null;
  return `Note: path was not provided, so search ran from the current working directory (${cwd}). Pass path explicitly to search another directory.`;
}

export function buildGrepPathNote(input: { path?: string | undefined }, cwd: string): string | null {
  if (input.path !== undefined) return null;
  return `Note: path was not provided, so search ran from the current working directory (${cwd}). Pass path explicitly to search another directory.`;
}

export function buildWebFetchDefaultsNote(input: {
  maxChars?: number | undefined;
  browserFallback?: boolean | undefined;
}): string | null {
  const parts: string[] = [];
  if (input.maxChars === undefined) {
    parts.push(`maxChars was not provided, so it defaulted to ${WEB_FETCH_DEFAULT_MAX_CHARS}`);
  }
  if (input.browserFallback === undefined) {
    parts.push("browserFallback was not provided, so it defaulted to true");
  }
  if (parts.length === 0) return null;
  return `Note: ${parts.join(". ")}.`;
}

export function buildWebSearchDefaultsNote(input: {
  maxResults?: number | undefined;
  browserFallback?: boolean | undefined;
}): string | null {
  const parts: string[] = [];
  if (input.maxResults === undefined) {
    parts.push(`maxResults was not provided, so it defaulted to ${WEB_SEARCH_DEFAULT_MAX_RESULTS}`);
  }
  if (input.browserFallback === undefined) {
    parts.push("browserFallback was not provided, so it defaulted to true");
  }
  if (parts.length === 0) return null;
  return `Note: ${parts.join(". ")}.`;
}

export function buildTaskThoroughnessNote(input: {
  subagent_type: string;
  thoroughness?: string | undefined;
}): string | null {
  if (input.subagent_type !== "general") return null;
  if (input.thoroughness === undefined) return null;
  return "Note: thoroughness applies only to explore subagents; it was ignored for general.";
}
