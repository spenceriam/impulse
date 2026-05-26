import { z } from "zod";
import type { RepairEvent, RepairContext } from "../types";
import { getAtPath, setAtPath } from "../path-utils";

/**
 * Repair 4: Wrap a bare string as a single-element array when an array is expected.
 * Skips JSON array strings (handled by stringifiedArray).
 */
export function repairStringToArray(ctx: RepairContext): RepairEvent[] {
  const events: RepairEvent[] = [];
  const seen = new Set<string>();

  for (const issue of ctx.issues) {
    if (issue.code !== z.ZodIssueCode.invalid_type) continue;
    if (issue.expected !== "array" || issue.received !== "string") continue;
    if (issue.path.length === 0) continue;

    const key = issue.path.join(".");
    if (seen.has(key)) continue;

    const value = getAtPath(ctx.input, issue.path);
    if (typeof value !== "string") continue;
    if (/^\s*\[/.test(value)) continue;

    setAtPath(ctx.input, issue.path, [value]);
    seen.add(key);
    events.push({ name: "stringToArray", path: [...issue.path] });
  }

  return events;
}
