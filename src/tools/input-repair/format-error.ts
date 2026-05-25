import type { z } from "zod";

function formatIssue(issue: z.ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";

  switch (issue.code) {
    case "invalid_type":
      return `${path}: expected ${issue.expected}, received ${issue.received}`;
    case "invalid_enum_value":
      return `${path}: invalid value; expected one of: ${issue.options.map(String).join(", ")}`;
    case "too_small":
      if (issue.type === "string") {
        return `${path}: must be at least ${issue.minimum} character(s)`;
      }
      if (issue.type === "array") {
        return `${path}: must contain at least ${issue.minimum} item(s)`;
      }
      return `${path}: value is too small`;
    case "too_big":
      if (issue.type === "string") {
        return `${path}: must be at most ${issue.maximum} character(s)`;
      }
      if (issue.type === "array") {
        return `${path}: must contain at most ${issue.maximum} item(s)`;
      }
      return `${path}: value is too large`;
    case "invalid_string":
      return `${path}: invalid string (${issue.validation})`;
    case "unrecognized_keys":
      return `${path}: unrecognized key(s): ${issue.keys.join(", ")}`;
    default:
      return `${path}: ${issue.message}`;
  }
}

/**
 * Produce a clean, model-readable validation error — never expose raw ZodError objects.
 */
export function formatValidationError(
  error: z.ZodError,
  toolName: string
): string {
  const lines = error.issues.map(formatIssue);
  const unique = [...new Set(lines)];

  if (unique.length === 1) {
    return `Invalid parameters for ${toolName}: ${unique[0]}`;
  }

  return `Invalid parameters for ${toolName}:\n- ${unique.join("\n- ")}`;
}
