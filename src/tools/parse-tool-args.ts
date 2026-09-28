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

/** Cap on the raw-JSON preview shown back to the model in a parse-error message. */
const RAW_JSON_PREVIEW_MAX = 300;

/**
 * Model-readable error for a tool call whose arguments never parsed as JSON,
 * even after the repair pass in repairToolArgumentsJson(). Names the tool,
 * surfaces the underlying parse error (which engines typically report with a
 * character position), states whether a repair was attempted, and tells the
 * model exactly what to do next — never a generic schema-mismatch error
 * against the `{ raw: ... }` fallback shape.
 */
export function formatToolArgParseError(
  toolName: string,
  rawJson: string,
  parseError: string,
  repaired: boolean
): string {
  const preview =
    rawJson.length > RAW_JSON_PREVIEW_MAX
      ? `${rawJson.slice(0, RAW_JSON_PREVIEW_MAX)}…`
      : rawJson;
  const repairNote = repaired
    ? " An automatic repair was attempted (e.g. adding missing quotes around a bare key) but the result was still invalid JSON."
    : "";
  return [
    `Invalid tool call: arguments for "${toolName}" were not valid JSON — ${parseError}.${repairNote}`,
    `Received: ${JSON.stringify(preview)}`,
    `Emit a single valid JSON object matching the "${toolName}" tool's schema.`,
  ].join("\n");
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
