import { z } from "zod";
import type { RepairEvent, RepairContext } from "../types";
import { getAtPath, setAtPath } from "../path-utils";

/**
 * Repair 3: Convert mistaken object wrappers into arrays.
 * Handles empty {} and single-key wrappers whose value is already an array.
 */
export function repairObjectToArray(ctx: RepairContext): RepairEvent[] {
  const events: RepairEvent[] = [];
  const seen = new Set<string>();

  for (const issue of ctx.issues) {
    if (issue.code !== z.ZodIssueCode.invalid_type) continue;
    if (issue.expected !== "array" || issue.received !== "object") continue;
    if (issue.path.length === 0) continue;

    const key = issue.path.join(".");
    if (seen.has(key)) continue;

    const value = getAtPath(ctx.input, issue.path);
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;

    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);

    if (keys.length === 0) {
      setAtPath(ctx.input, issue.path, []);
      seen.add(key);
      events.push({ name: "objectToArray", path: [...issue.path] });
      continue;
    }

    if (keys.length === 1) {
      const onlyValue = obj[keys[0]!];
      if (Array.isArray(onlyValue)) {
        setAtPath(ctx.input, issue.path, onlyValue);
        seen.add(key);
        events.push({ name: "objectToArray", path: [...issue.path] });
      }
    }
  }

  return events;
}
