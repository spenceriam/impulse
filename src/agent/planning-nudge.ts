/**
 * Detect replanning loops (todo_write + mkdir without substantive tools).
 */

const SUBSTANTIVE_TOOLS = new Set([
  "bash",
  "file_write",
  "file_edit",
  "file_read",
  "grep",
  "glob",
  "task",
  "question",
  "web_search",
  "web_fetch",
  "github_issue",
]);

const DEFER_TO_USER =
  " If this conflicts with the user's latest message, follow the user's message.";

export const PLANNING_LOOP_NUDGE_MESSAGE =
  "[System] Stop replanning. Execute the next unchecked todo with substantive tools (read, write, bash, task) — do not recreate folders or resubmit an unchanged todo list (status updates are good — keep them coming)." +
  DEFER_TO_USER;

export function isSubstantiveToolBatch(toolNames: string[]): boolean {
  return toolNames.some((name) => SUBSTANTIVE_TOOLS.has(name));
}

export function shouldInjectPlanningLoopNudge(opts: {
  planningIterations: number;
  nudgeUsed: boolean;
}): boolean {
  if (opts.nudgeUsed) return false;
  return opts.planningIterations >= 3;
}
