/**
 * Goal loop judge + continuation (fail-open auxiliary model).
 */

import { getProviderManager } from "../api/manager.js";
import type { GoalState } from "../session/goal-state.js";

export type GoalJudgeVerdict = "done" | "continue";

export interface GoalJudgeResult {
  verdict: GoalJudgeVerdict;
  reason: string;
}

const JUDGE_PROMPT = `You judge whether a coding agent goal is complete.
Reply with exactly one line:
DONE: <brief reason>
or
CONTINUE: <brief reason>`;

/** Fail-open: continue on any judge error. */
export async function judgeGoal(
  goal: GoalState,
  lastAssistantText: string,
  judgeModel?: string
): Promise<GoalJudgeResult> {
  const model = judgeModel?.trim();
  if (!model) {
    return { verdict: "continue", reason: "no judge model configured" };
  }

  try {
    const manager = await getProviderManager();
    const provider = manager.getProvider(model);
    const response = await provider.complete({
      model,
      messages: [
        { role: "system", content: JUDGE_PROMPT },
        {
          role: "user",
          content: `Goal: ${goal.text}\n\nLast assistant message:\n${lastAssistantText.slice(0, 4000)}`,
        },
      ],
      stream: false,
      max_tokens: 120,
      reasoningLevel: "off",
    });

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
    return { verdict: "continue", reason: `judge error (fail-open): ${msg}` };
  }
}

export function buildGoalContinuationMessage(goal: GoalState): string {
  return `Goal continuation (turn ${goal.turnsUsed + 1}/${goal.maxTurns}): ${goal.text}\nContinue working toward this goal. Finish concisely if context is tight.`;
}
