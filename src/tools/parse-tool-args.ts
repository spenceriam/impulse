/**
 * Parse tool call argument JSON from providers. Some models emit keys like
 * `"context: "value"` instead of `"context": "value"`.
 */
export function repairToolArgumentsJson(json: string): string {
  let repaired = json.trim();
  if (!repaired) return repaired;

  // `"context: "` → `"context": "` (and similar bare keys)
  repaired = repaired.replace(/"([a-zA-Z_][a-zA-Z0-9_]*):\s/g, '"$1": ');

  return repaired;
}

export function parseToolCallArguments(json: string): {
  args: Record<string, unknown>;
  repaired: boolean;
  parseError?: string;
} {
  const trimmed = json.trim();
  if (!trimmed) {
    return { args: {}, repaired: false };
  }

  try {
    return {
      args: JSON.parse(trimmed) as Record<string, unknown>,
      repaired: false,
    };
  } catch (firstError) {
    const repairedJson = repairToolArgumentsJson(trimmed);
    if (repairedJson !== trimmed) {
      try {
        return {
          args: JSON.parse(repairedJson) as Record<string, unknown>,
          repaired: true,
        };
      } catch {
        // fall through
      }
    }

    return {
      args: { raw: trimmed },
      repaired: repairedJson !== trimmed,
      parseError:
        firstError instanceof Error ? firstError.message : String(firstError),
    };
  }
}
