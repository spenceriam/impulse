/**
 * Orchestrator planner phase (#221).
 *
 * A read-only planning loop that mirrors Antigravity's first stage: the
 * planner explores the codebase with read-only tools, resolves ambiguities,
 * and returns a concrete plan that names its own re-plan triggers. When the
 * user's message needs no changes (a question, review, or explanation) it
 * answers directly and no executor run follows.
 *
 * Shares the session's conversation (the planner sees everything the user and
 * executor have said) but keeps its own exploration in memory: only the
 * resulting plan is injected for the executor.
 */

import type { ChatMessage } from "../api/types.js";
import type { ToolDefinition } from "../api/types.js";
import type { LoopEvents } from "./loop.js";
import type { Message } from "../session/store.js";
import { SessionManager } from "../session/manager.js";
import { Tool } from "../tools/registry.js";
import { buildChatMessages } from "./build-chat-messages.js";
import { accumulateToolCallDelta, type PartialToolCall } from "./tool-call-accumulator.js";
import { isPlannerTool } from "./orchestrator.js";

/** Tool-call rounds the planner may spend exploring before it must plan. */
export const PLANNER_MAX_ROUNDS = 12;

const PLAN_OPEN = "<plan>";
const PLAN_CLOSE = "</plan>";

export type PlannerOutcome =
  | { kind: "plan"; plan: string; explored: string[] }
  | { kind: "answer"; text: string }
  | { kind: "aborted" }
  | { kind: "error"; message: string };

export const PLANNER_SYSTEM_ADDENDUM = `## Orchestrator: planner role

You are the PLANNER for this turn. A separate executor model will do the work.

- You are read-only. You may explore the codebase (file_read, grep, glob, ls, web_search, web_fetch) to ground the plan, but you never edit files or run commands.
- If the user's message is a question, review, or explanation that needs no changes, answer it directly in plain prose with NO ${PLAN_OPEN} block. That answer is shown to the user and the turn ends.
- Otherwise, write the plan inside one ${PLAN_OPEN} ... ${PLAN_CLOSE} block:
  1. Goal, in one sentence.
  2. Numbered steps, each naming the files or commands it touches.
  3. Verification: the exact command or check that proves each step.
  4. Re-plan triggers: the conditions under which the executor must stop and hand control back.
- Keep the plan concrete enough that a smaller model can execute it without re-deciding anything.`;

/** Split a planner reply into the plan block and any prose around it. */
export function parsePlannerReply(text: string): { plan: string | null; prose: string } {
  const open = text.indexOf(PLAN_OPEN);
  const close = text.indexOf(PLAN_CLOSE);
  if (open === -1 || close === -1 || close < open) {
    return { plan: null, prose: text.trim() };
  }
  const plan = text.slice(open + PLAN_OPEN.length, close).trim();
  const prose = (text.slice(0, open) + text.slice(close + PLAN_CLOSE.length)).trim();
  return { plan: plan.length > 0 ? plan : null, prose };
}

/** Summarize what the executor did, for a re-plan request. */
export function formatProgressReport(entries: Array<{ tool: string; ok: boolean; note?: string }>): string {
  if (entries.length === 0) return "(no steps executed yet)";
  return entries
    .map((e, i) => `${i + 1}. ${e.tool} — ${e.ok ? "ok" : "FAILED"}${e.note ? `: ${e.note}` : ""}`)
    .join("\n");
}

export interface PlannerPhaseParams {
  complete: (opts: {
    model: string;
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    stream: true;
    signal?: AbortSignal;
    reasoningLevel?: string;
  }) => AsyncIterable<import("../api/types.js").ChatCompletionChunk>;
  plannerModel: string;
  plannerReasoning: string;
  systemPrompt: string;
  events: LoopEvents;
  signal: AbortSignal;
  /** Set on a re-plan: the original plan plus what happened since. */
  replanNote?: string;
}

/**
 * Run the read-only planner. Returns a plan, a direct answer, or a failure.
 */
export async function runPlannerPhase(params: PlannerPhaseParams): Promise<PlannerOutcome> {
  const { complete, plannerModel, plannerReasoning, systemPrompt, events, signal } = params;
  const session = SessionManager.getCurrentSession();
  const base: ChatMessage[] = buildChatMessages(
    session?.messages ?? [],
    `${systemPrompt}\n\n${PLANNER_SYSTEM_ADDENDUM}`
  );

  const read_onlyTools: ToolDefinition[] = Tool.getAPIDefinitionsForMode("EXPLORE").filter((t) =>
    isPlannerTool(t.function.name)
  );

  const working: ChatMessage[] = [...base];
  if (params.replanNote) {
    working.push({
      role: "user",
      content: `Control returned from the executor. Repair the plan.\n\n${params.replanNote}\n\nReturn the revised plan in one ${PLAN_OPEN} block.`,
    });
  }

  const explored: string[] = [];
  let lastText = "";

  for (let round = 0; round < PLANNER_MAX_ROUNDS; round++) {
    if (signal.aborted) return { kind: "aborted" };

    let text = "";
    const partials = new Map<number, PartialToolCall>();
    try {
      for await (const chunk of complete({
        model: plannerModel,
        messages: working,
        tools: read_onlyTools,
        stream: true,
        signal,
        reasoningLevel: plannerReasoning,
      })) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        if (typeof delta.content === "string") text += delta.content;
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            accumulateToolCallDelta(partials, tc, (idx) => `plan_${idx}_${Date.now()}`);
          }
        }
      }
    } catch (e) {
      if (signal.aborted) return { kind: "aborted" };
      return { kind: "error", message: e instanceof Error ? e.message : String(e) };
    }

    const calls = [...partials.values()].sort((a, b) => a.index - b.index);
    lastText = text;

    if (calls.length === 0) {
      const { plan, prose } = parsePlannerReply(text);
      if (plan) return { kind: "plan", plan, explored };
      const answer = prose || text.trim();
      return answer
        ? { kind: "answer", text: answer }
        : { kind: "error", message: "the planner returned an empty reply" };
    }

    // Read-only exploration: run each call and feed the results back.
    working.push({
      role: "assistant",
      content: text,
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: "function" as const,
        function: { name: c.name, arguments: c.argumentsJson || "{}" },
      })),
    });

    for (const call of calls) {
      if (!isPlannerTool(call.name)) {
        working.push({
          role: "tool",
          tool_call_id: call.id,
          content: "Planner is read-only; this tool is not available. Plan the step for the executor instead.",
        });
        continue;
      }
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.argumentsJson || "{}") as Record<string, unknown>;
      } catch {
        /* validated by the tool */
      }
      const started = Date.now();
      events.onToolStart(call.id, call.name, args);
      const result = await Tool.execute(call.name, args);
      events.onToolEnd(call.id, call.name, result, Date.now() - started);
      explored.push(call.name);
      const output = result.success ? result.output : `error: ${result.output}`;
      working.push({
        role: "tool",
        tool_call_id: call.id,
        content: output.length > 4000 ? `${output.slice(0, 4000)}…` : output,
      });
      if (signal.aborted) return { kind: "aborted" };
    }
  }

  // Out of rounds: accept whatever plan-shaped text the last reply held.
  const { plan, prose } = parsePlannerReply(lastText);
  if (plan) return { kind: "plan", plan, explored };
  return {
    kind: "error",
    message: prose
      ? "the planner did not finish within its exploration budget"
      : "the planner did not produce a plan",
  };
}

/** Format the plan for injection ahead of the executor run. */
export function formatPlanInjection(plan: string, revision: number): string {
  const heading = revision === 0 ? "Plan for this turn" : `Revised plan (revision ${revision + 1})`;
  return `${heading} — written by the planner. Follow the steps in order and run each verification.\n\n${plan}`;
}

/** Type guard for callers that persist planner notes. */
export function asInjectedMessage(content: string): Message {
  return {
    role: "user",
    content,
    injected: true,
    timestamp: new Date().toISOString(),
  };
}
