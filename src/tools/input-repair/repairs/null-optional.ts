import { z } from "zod";
import type { RepairEvent, RepairContext } from "../types";
import { deleteAtPath } from "../path-utils";

/**
 * Repair 1: Replace null on optional fields by omitting the key entirely.
 * Zod .optional() rejects null but accepts absent keys.
 */
export function repairNullForOptional(ctx: RepairContext): RepairEvent[] {
  const events: RepairEvent[] = [];
  const seen = new Set<string>();

  for (const issue of ctx.issues) {
    if (issue.code !== z.ZodIssueCode.invalid_type) continue;
    if (issue.received !== "null") continue;
    if (issue.path.length === 0) continue;

    const key = issue.path.join(".");
    if (seen.has(key)) continue;
    seen.add(key);

    deleteAtPath(ctx.input, issue.path);
    events.push({ name: "nullForOptional", path: [...issue.path] });
  }

  return events;
}
