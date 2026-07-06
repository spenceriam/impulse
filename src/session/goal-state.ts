/**
 * Persistent goal loop state (Hermes-style /goal).
 */

export interface GoalState {
  text: string;
  status: "active" | "paused" | "paused_judge_unavailable" | "done";
  turnsUsed: number;
  maxTurns: number;
  lastJudgeReason?: string;
  /** Plan revision this goal tracks; when set, the judge evaluates against its tasks.md checklist. */
  planRevisionId?: string;
}

export const DEFAULT_GOAL_MAX_TURNS = 20;

export function createGoalState(
  text: string,
  options?: { maxTurns?: number; planRevisionId?: string }
): GoalState {
  return {
    text: text.trim(),
    status: "active",
    turnsUsed: 0,
    maxTurns: options?.maxTurns ?? DEFAULT_GOAL_MAX_TURNS,
    ...(options?.planRevisionId ? { planRevisionId: options.planRevisionId } : {}),
  };
}

export function parseGoalState(raw: unknown): GoalState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const g = raw as Record<string, unknown>;
  if (typeof g["text"] !== "string" || !g["text"].trim()) return undefined;
  const status = g["status"];
  if (
    status !== "active" &&
    status !== "paused" &&
    status !== "paused_judge_unavailable" &&
    status !== "done"
  ) return undefined;
  return {
    text: g["text"].trim(),
    status,
    turnsUsed: typeof g["turnsUsed"] === "number" ? g["turnsUsed"] : 0,
    maxTurns:
      typeof g["maxTurns"] === "number" && g["maxTurns"] > 0
        ? g["maxTurns"]
        : DEFAULT_GOAL_MAX_TURNS,
    ...(typeof g["lastJudgeReason"] === "string"
      ? { lastJudgeReason: g["lastJudgeReason"] }
      : {}),
    ...(typeof g["planRevisionId"] === "string" && g["planRevisionId"].trim()
      ? { planRevisionId: g["planRevisionId"].trim() }
      : {}),
  };
}
