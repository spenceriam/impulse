/**
 * Allow-all bypass: reduce repeated todo-only agent loop iterations.
 */

import { isAllowAllBypass } from "../permission/index.js";

const DEFER_TO_USER =
  " If this conflicts with the user's latest message, follow the user's message.";

export const ALLOW_ALL_TODO_NUDGE_MESSAGE =
  "[System] Permission bypass is active. Proceed with substantive tools now." +
  DEFER_TO_USER;

const TODO_ONLY_TOOLS = new Set(["todo_read", "todo_write"]);

export function isTodoOnlyToolBatch(toolNames: string[]): boolean {
  if (toolNames.length === 0) return false;
  return toolNames.every((name) => TODO_ONLY_TOOLS.has(name));
}

export function shouldInjectAllowAllTodoNudge(opts: {
  consecutiveTodoOnlyRounds: number;
  nudgeUsed: boolean;
}): boolean {
  return (
    isAllowAllBypass() &&
    !opts.nudgeUsed &&
    opts.consecutiveTodoOnlyRounds >= 2
  );
}
