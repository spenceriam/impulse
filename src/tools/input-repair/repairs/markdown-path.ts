import type { RepairEvent, RepairContext } from "../types";
import { getAtPath, setAtPath } from "../path-utils";
import { unwrapDegeneratePath } from "../path-markdown";

const PATH_LIKE_KEYS = new Set([
  "filePath",
  "path",
  "pattern",
  "workdir",
  "target_directory",
  "include",
  "old_string",
  "new_string",
]);

function collectCandidatePaths(
  input: unknown,
  issues: RepairContext["issues"],
  prefix: (string | number)[] = []
): (string | number)[][] {
  const paths: (string | number)[][] = [];

  for (const issue of issues) {
    if (issue.path.length > 0) {
      paths.push([...issue.path]);
    }
  }

  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const keyPath = [...prefix, key];
      if (typeof value === "string" && PATH_LIKE_KEYS.has(key)) {
        paths.push(keyPath);
      } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        paths.push(...collectCandidatePaths(value, [], keyPath));
      }
    }
  }

  return paths;
}

/**
 * Repair 5: Unwrap degenerate Markdown auto-links leaked into file paths.
 * Legitimate Markdown links (different link text vs target) are left untouched.
 */
export function repairMarkdownPathUnwrap(ctx: RepairContext): RepairEvent[] {
  const events: RepairEvent[] = [];
  const seen = new Set<string>();

  const candidates = collectCandidatePaths(ctx.input, ctx.issues);

  for (const path of candidates) {
    const key = path.join(".");
    if (seen.has(key)) continue;

    const value = getAtPath(ctx.input, path);
    if (typeof value !== "string") continue;

    const unwrapped = unwrapDegeneratePath(value);
    if (unwrapped === null) continue;

    setAtPath(ctx.input, path, unwrapped);
    seen.add(key);
    events.push({ name: "markdownPathUnwrap", path: [...path] });
  }

  return events;
}
