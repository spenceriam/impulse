/**
 * Accumulate streaming tool_call deltas into complete invocations.
 * Tool name handling: assign on first chunk, never append unrelated names.
 */

export interface PartialToolCall {
  index: number;
  id: string;
  name: string;
  argumentsJson: string;
}

export interface ToolCallDelta {
  index?: number | undefined;
  id?: string | undefined;
  function?: {
    name?: string | undefined;
    arguments?: string | undefined;
  } | undefined;
}

function nextFreeIndex(
  partials: Map<number, PartialToolCall>,
  requestedIndex: number
): number {
  let max = requestedIndex;
  for (const k of partials.keys()) max = Math.max(max, k);
  return max + 1;
}

function isParsableJsonObject(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/** When a provider reuses the same index for parallel tools, allocate a fresh slot. */
export function resolveToolCallIndex(
  partials: Map<number, PartialToolCall>,
  requestedIndex: number,
  incomingName: string,
  incomingArgs: string,
  incomingId?: string
): number {
  const existing = partials.get(requestedIndex);
  if (!existing) return requestedIndex;

  if (incomingId && existing.id && incomingId !== existing.id) {
    return nextFreeIndex(partials, requestedIndex);
  }

  if (!incomingName || !existing.name) return requestedIndex;

  if (incomingName !== existing.name && !incomingName.startsWith(existing.name)) {
    return nextFreeIndex(partials, requestedIndex);
  }

  // Same tool name on reused index — parallel call if both send complete JSON objects.
  if (
    incomingName === existing.name &&
    incomingArgs.trimStart().startsWith("{") &&
    isParsableJsonObject(existing.argumentsJson)
  ) {
    return nextFreeIndex(partials, requestedIndex);
  }

  return requestedIndex;
}

export function accumulateToolCallDelta(
  partials: Map<number, PartialToolCall>,
  tc: ToolCallDelta,
  callIdFallback: (idx: number) => string
): void {
  const requestedIndex = tc.index ?? 0;
  const incomingName = tc.function?.name ?? "";
  const incomingArgs = tc.function?.arguments ?? "";
  const idx = resolveToolCallIndex(
    partials,
    requestedIndex,
    incomingName,
    incomingArgs,
    tc.id
  );

  if (!partials.has(idx)) {
    partials.set(idx, {
      index: idx,
      id: tc.id ?? callIdFallback(idx),
      name: incomingName,
      argumentsJson: incomingArgs,
    });
    return;
  }

  const partial = partials.get(idx)!;
  if (tc.id) partial.id = tc.id;
  if (incomingName) partial.name = incomingName;
  if (incomingArgs) partial.argumentsJson += incomingArgs;
}
