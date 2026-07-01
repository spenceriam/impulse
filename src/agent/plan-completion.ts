import fs from "fs";
import { getActivePlanRevision } from "../plan/revisions.js";
import { toRelativePlanPath } from "../plan/paths.js";
import type { Mode } from "../constants.js";

/**
 * Decision values for PLAN mode completion.
 *
 * execute — switch to AGENT and immediately run tasks.md
 * proceed — switch to AGENT and await the next user turn
 * revise  — stay in PLAN, end agent turn, prompt "what to revise?"
 * cancel  — stay in PLAN, discard the handoff
 */
export type PlanCompletionDecision = "execute" | "proceed" | "revise" | "cancel";

export interface PlanCompletionHandoff {
  planDirRel: string;
  tasksPathRel: string;
}

/**
 * Detect whether a set_mode(AGENT) call issued from PLAN mode should be
 * intercepted by the plan-completion overlay instead of switching modes
 * silently. Returns null when the handoff doesn't apply: wrong mode
 * transition, no active plan revision, or tasks.md hasn't been written yet.
 */
export function checkPlanCompletionHandoff(
  currentMode: Mode,
  requestedMode: string,
  sessionId: string,
  cwd = process.cwd()
): PlanCompletionHandoff | null {
  if (currentMode !== "PLAN" || requestedMode !== "AGENT") return null;

  const revision = getActivePlanRevision(sessionId, cwd);
  if (!revision) return null;

  const tasksPath = revision.files["tasks.md"];
  if (!tasksPath || !fs.existsSync(tasksPath)) return null;

  return {
    planDirRel: toRelativePlanPath(revision.dir, cwd),
    tasksPathRel: toRelativePlanPath(tasksPath, cwd),
  };
}

export interface PlanCompletionBehavior {
  /** Whether the real set_mode tool call should actually run (switch to AGENT). */
  performSwitch: boolean;
  /** Instruction text appended to the set_mode tool result. */
  output: string;
}

/** Map a user's plan-completion decision to loop behavior + tool-result text. */
export function planCompletionToolBehavior(
  decision: PlanCompletionDecision,
  tasksPathRel: string
): PlanCompletionBehavior {
  switch (decision) {
    case "execute":
      return {
        performSwitch: true,
        output: `User chose EXECUTE — immediately read ${tasksPathRel} and implement its tasks in order, checking them off as you complete them. Do not wait for further input.`,
      };
    case "proceed":
      return {
        performSwitch: true,
        output: `User chose PROCEED — mode is now AGENT. Briefly confirm the handoff and end your turn; wait for the user's next instruction before implementing.`,
      };
    case "revise":
      return {
        performSwitch: false,
        output: `User chose REVISE — stay in PLAN mode. Ask the user what they want revised (one direct question or a single question tool call), then end your turn.`,
      };
    case "cancel":
      return {
        performSwitch: false,
        output: `User cancelled the handoff — remain in PLAN mode and end your turn.`,
      };
  }
}
