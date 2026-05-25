import { z } from "zod";
import type { RepairEvent, RepairContext } from "../types";
import { getAtPath, setAtPath } from "../path-utils";

/**
 * Repair 2: Parse JSON string values into real arrays when the schema expects an array.
 */
export function repairStringifiedArray(ctx: RepairContext): RepairEvent[] {
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
    if (!/^\s*\[/.test(value)) continue;

    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) continue;

      setAtPath(ctx.input, issue.path, parsed);
      seen.add(key);
      events.push({ name: "stringifiedArray", path: [...issue.path] });
    } catch {
      // Not valid JSON — leave for other repairs or final error.
    }
  }

  return events;
}
