/**
 * Goal loop judge + continuation (fail-open auxiliary model).
 */

import { getProviderManager } from "../api/manager.js";
import type { GoalState } from "../session/goal-state.js";
import type { Mode } from "../constants.js";
import { getCurrentMode } from "../tools/mode-state.js";
import { registerGoalLoopExecution } from "./goal-execution.js";

export type GoalJudgeVerdict = "done" | "continue" | "judge_unavailable";

export interface GoalJudgeResult {
  verdict: GoalJudgeVerdict;
  reason: string;
}

export interface GoalLoopActionResult<T> {
  executed: boolean;
  value?: T;
}

/** Current authority and state required to execute or re-enter the goal loop. */
export function isGoalLoopExecutable(
  mode: Mode,
  experimentalGoalEnabled: boolean,
  state: GoalState | undefined
): boolean {
  return mode === "AGENT" && experimentalGoalEnabled && state?.status === "active";
}

/** Public authority gate for judge, persistence, and continuation side effects. */
export async function runGoalLoopActionIfExecutable<T>(input: {
  mode: Mode;
  experimentalGoalEnabled: boolean;
  state: GoalState | undefined;
  action: (signal: AbortSignal) => Promise<T>;
}): Promise<GoalLoopActionResult<T>> {
  const canExecute = (signal?: AbortSignal) =>
    signal?.aborted !== true &&
    getCurrentMode() === "AGENT" &&
    isGoalLoopExecutable(input.mode, input.experimentalGoalEnabled, input.state);

  if (!canExecute()) {
    return { executed: false };
  }

  const execution = registerGoalLoopExecution();
  try {
    if (!canExecute(execution.signal)) return { executed: false };
    const value = await input.action(execution.signal);
    if (!canExecute(execution.signal)) return { executed: false };
    return { executed: true, value };
  } catch (error) {
    if (execution.signal.aborted) return { executed: false };
    throw error;
  } finally {
    execution.complete();
  }
}

const JUDGE_PROMPT = `You judge whether a coding agent goal is complete.
Reply with exactly one line:
DONE: <brief reason>
or
CONTINUE: <brief reason>`;

const CHECKLIST_JUDGE_PROMPT = `You judge whether a coding agent has completed a plan's task checklist.
The goal is complete ONLY when every task in tasks.md is done (checked off or explicitly reported complete).
Reply with exactly one line:
DONE: <brief reason>
or
CONTINUE: <which tasks remain>`;

export interface JudgeMessage {
  role: "system" | "user";
  content: string;
}

/** Build the judge's [system, user] message pair, pure and unit-testable. */
export function buildJudgeMessages(
  goal: GoalState,
  lastAssistantText: string,
  planTasksMarkdown?: string
): [JudgeMessage, JudgeMessage] {
  if (planTasksMarkdown) {
    return [
      { role: "system", content: CHECKLIST_JUDGE_PROMPT },
      {
        role: "user",
        content: `Goal: ${goal.text}\n\nPlan tasks.md (revision ${goal.planRevisionId ?? "unknown"}):\n${planTasksMarkdown.slice(0, 6000)}\n\nLast assistant message:\n${lastAssistantText.slice(0, 4000)}`,
      },
    ];
  }

  return [
    { role: "system", content: JUDGE_PROMPT },
    {
      role: "user",
      content: `Goal: ${goal.text}\n\nLast assistant message:\n${lastAssistantText.slice(0, 4000)}`,
    },
  ];
}

export async function judgeGoal(
  goal: GoalState,
  lastAssistantText: string,
  judgeModel?: string,
  opts?: { planTasksMarkdown?: string; signal?: AbortSignal }
): Promise<GoalJudgeResult> {
  const model = judgeModel?.trim();
  if (!model) {
    return { verdict: "judge_unavailable", reason: "no judge model configured" };
  }

  try {
    const manager = await getProviderManager();
    if (opts?.signal?.aborted) {
      return { verdict: "judge_unavailable", reason: "judge cancelled" };
    }
    const provider = manager.getProvider(model);
    const messages = buildJudgeMessages(goal, lastAssistantText, opts?.planTasksMarkdown);
    const response = await provider.complete({
      model,
      messages,
      stream: false,
      max_tokens: 200,
      reasoningLevel: "off",
      ...(opts?.signal ? { signal: opts.signal } : {}),
    });

    if (opts?.signal?.aborted) {
      return { verdict: "judge_unavailable", reason: "judge cancelled" };
    }

    const raw = response.choices[0]?.message?.content ?? "";
    const text = (typeof raw === "string" ? raw : "").trim();
    const upper = text.toUpperCase();
    if (upper.startsWith("DONE:")) {
      return { verdict: "done", reason: text.slice(5).trim() || "goal met" };
    }
    if (upper.startsWith("CONTINUE:")) {
      return { verdict: "continue", reason: text.slice(9).trim() || "more work needed" };
    }
    return { verdict: "continue", reason: "judge inconclusive" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { verdict: "judge_unavailable", reason: `judge error: ${msg}` };
  }
}

export function buildGoalContinuationMessage(goal: GoalState, opts?: { planTasksPath?: string }): string {
  const base = `Goal continuation (turn ${goal.turnsUsed + 1}/${goal.maxTurns}): ${goal.text}\nContinue working toward this goal. Finish concisely if context is tight.`;
  if (opts?.planTasksPath) {
    return `${base}\nWork from the plan checklist at \`${opts.planTasksPath}\`; complete unchecked tasks in order and check them off.`;
  }
  return base;
}
