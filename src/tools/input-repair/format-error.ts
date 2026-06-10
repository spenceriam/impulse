import type { z } from "zod";
import { getAtPath } from "./path-utils";

function formatIssue(issue: z.ZodIssue, input: unknown): string {
  const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
  
  // Extract the actual value that failed validation for better error messages
  const actualValue = getAtPath(input, issue.path);

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
      return `${path}: ${issue.message}`;
    case "unrecognized_keys":
      return `${path}: unrecognized key(s): ${issue.keys.join(", ")}`;
    default:
      // For custom validations (like .refine()), include the actual value when it's short
      if (typeof actualValue === "string" && actualValue.length < 100) {
        return `${path}: ${issue.message} (received: "${actualValue}")`;
      }
      return `${path}: ${issue.message}`;
  }
}

const MAX_ERROR_LINES = 6;

/** Normalize array indices in a dotted path for grouping repeated issues. */
function normalizePathForCollapse(path: string): string {
  return path.replace(/\.\d+/g, "[*]");
}

function splitIssueLine(line: string): { path: string; message: string } {
  const colonIdx = line.indexOf(": ");
  if (colonIdx < 0) return { path: "(root)", message: line };
  return { path: line.slice(0, colonIdx), message: line.slice(colonIdx + 2) };
}

/**
 * Collapse repeated validation issues (e.g. missing description on 9 options).
 */
export function collapseValidationLines(lines: string[]): string[] {
  const groups = new Map<string, { sample: string; count: number }>();
  const order: string[] = [];

  for (const line of lines) {
    const { path, message } = splitIssueLine(line);
    const key = `${normalizePathForCollapse(path)}::${message}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
    } else {
      groups.set(key, { sample: line, count: 1 });
      order.push(key);
    }
  }

  const collapsed: string[] = [];
  for (const key of order) {
    const { sample, count } = groups.get(key)!;
    if (count > 3) {
      const { path, message } = splitIssueLine(sample);
      collapsed.push(`${normalizePathForCollapse(path)}: ${message} (${count} occurrences)`);
    } else {
      for (let i = 0; i < count; i++) {
        collapsed.push(sample);
      }
    }
  }

  if (collapsed.length <= MAX_ERROR_LINES) return collapsed;

  const shown = collapsed.slice(0, MAX_ERROR_LINES);
  shown.push(`(+${collapsed.length - MAX_ERROR_LINES} more)`);
  return shown;
}

/**
 * Produce a clean, model-readable validation error — never expose raw ZodError objects.
 */
export function formatValidationError(
  error: z.ZodError,
  toolName: string,
  input?: unknown
): string {
  const lines = error.issues.map((issue) => formatIssue(issue, input));
  const collapsed = collapseValidationLines(Array.from(new Set(lines)));

  if (collapsed.length === 1) {
    return `Invalid parameters for ${toolName}: ${collapsed[0]}`;
  }

  return `Invalid parameters for ${toolName}:\n- ${collapsed.join("\n- ")}`;
}
