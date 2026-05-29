import { MAX_CONCURRENT_SUBAGENTS } from "../agent/task-pool.js";

/** True when a turn must prompt before running this many general sub-agents. */
export function needsGeneralBatchPermission(generalCount: number): boolean {
  return generalCount > MAX_CONCURRENT_SUBAGENTS;
}

export type TaskBatchPermissionItem = {
  subagentType: string;
  description: string;
  promptPreview: string;
};

/** User decision for a batch of general sub-agents in one turn. */
export type TaskBatchDecision =
  | { action: "approve" }
  | { action: "deny" }
  | { action: "run_first"; count: number }
  | { action: "cancel" };

export type TaskBatchPermissionInput = {
  count: number;
  items: TaskBatchPermissionItem[];
};
