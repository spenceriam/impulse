import { z } from "zod";
import { randomUUID } from "crypto";
import { Bus } from "../bus/index.js";
import { ExecutionHandoffEvents } from "../bus/events.js";
import {
  currentExecutionContext,
  executionCwd,
  type RuntimeExecutionHooks,
} from "../execution/context.js";
import { PreviewManager } from "../preview/manager.js";
import { getCurrentMode } from "./mode-state.js";
import { Tool, type ToolResult } from "./registry.js";

export type ExecutionHandoffChoice = "preview" | "agent" | "stay";
export const USER_HANDOFF_AUTHORITY = Symbol("direct user execution handoff");

const HandoffSchema = z.object({
  request: z.string().min(1).describe("The consequential work the user requested"),
  description: z.string().min(1).describe("Why execution authority is needed"),
});

let pending: {
  id: string;
  resolve: (choice: ExecutionHandoffChoice) => void;
} | undefined;

export { ExecutionHandoffEvents };

export function hasPendingExecutionHandoff(): boolean {
  return pending !== undefined;
}

export function resolveExecutionHandoff(
  id: string,
  choice: ExecutionHandoffChoice,
  authority: symbol
): boolean {
  if (authority !== USER_HANDOFF_AUTHORITY || pending?.id !== id) return false;
  const resolver = pending.resolve;
  pending = undefined;
  resolver(choice);
  return true;
}

const DESCRIPTION = `Request a direct-user execution handoff for consequential work in ASK.

The client—not the model—offers exactly Preview safely, Switch to AGENT, or Stay in ASK. Use this when the user asks for project mutation or general/writing delegation while ASK is active. Never infer or replay the choice. Clients without interactive elicitation stay in ASK instead of blocking.`;

function choiceLabel(choice: ExecutionHandoffChoice): string {
  return choice === "preview"
    ? "Preview safely"
    : choice === "agent"
      ? "Switch to AGENT"
      : "Stay in ASK";
}

async function runtimeExecutionHandoff(
  runtime: RuntimeExecutionHooks,
  input: { request: string; description: string }
): Promise<ToolResult> {
  const answers = await runtime.requestQuestion({
    prompt: `${input.description}\n\nHow should Impulse handle this consequential request?`,
    choices: [
      { id: "preview", label: "Preview safely", description: "Run in an isolated worktree and sandbox; review before applying." },
      { id: "agent", label: "Switch to AGENT", description: "Enable execution authority for this session." },
      { id: "stay", label: "Stay in ASK", description: "Keep the project read-only." },
    ],
  });
  const selected = answers?.[0];
  const choice: ExecutionHandoffChoice = selected === "preview" || selected === "agent"
    ? selected
    : "stay";

  if (choice === "stay") {
    const unavailable = answers === null;
    return {
      success: true,
      output: unavailable
        ? "Direct-user handoff is unavailable in this client; stayed in ASK and no execution was started. The user can switch with the client's mode control."
        : "Direct user choice: Stay in ASK.",
      metadata: {
        type: "execution_handoff",
        choice,
        ...(unavailable ? { interactionUnavailable: true } : {}),
      },
    };
  }

  if (choice === "agent") {
    runtime.setMode("AGENT");
    if (runtime.getMode() !== "AGENT") {
      return {
        success: false,
        output: "Direct user chose Switch to AGENT, but the runtime could not grant execution authority; stayed in ASK.",
        metadata: { type: "execution_handoff", choice: "stay", requestedChoice: choice },
      };
    }
    return {
      success: true,
      output: "Direct user choice: Switch to AGENT. Execution authority is now enabled.",
      metadata: { type: "execution_handoff", choice },
    };
  }

  const manager = new PreviewManager({ activeWorkspace: executionCwd() });
  const preview = await manager.preview({
    prompt: input.request,
    description: input.description,
  });
  if (preview.status !== "ready") {
    return {
      success: false,
      output: `${preview.notice}\nStayed in ASK; no host fallback was used.`,
      metadata: { type: "execution_handoff", choice, previewStatus: preview.status },
    };
  }

  const changed = preview.changedFiles.length > 0
    ? preview.changedFiles.join(", ")
    : "no files";
  const reviewAnswers = await runtime.requestQuestion({
    prompt: [
      "Safe preview ready · PREVIEW · bubblewrap · network off · process cleanup confirmed",
      `Changed: ${changed}`,
      preview.diffStat,
      ...preview.agentSummary.slice(0, 3).map((line) => `- ${line}`),
    ].filter(Boolean).join("\n"),
    choices: [
      { id: "apply", label: "Apply", description: "Apply only the reviewed preview delta; ASK remains the agent authority." },
      { id: "discard", label: "Discard", description: "Delete the preview and leave the project unchanged." },
      { id: "keep", label: "Keep preview", description: "Keep the isolated workspace for manual review." },
    ],
  });
  const reviewChoice = reviewAnswers?.[0];

  if (reviewChoice === "apply") {
    const applied = await manager.apply(preview.id);
    if (applied.ok) {
      return {
        success: true,
        output: `Applied reviewed preview: ${applied.changedFiles.join(", ") || "no files"}. ASK remains read-only for the agent.`,
        metadata: { type: "execution_handoff", choice, previewDecision: "apply", previewId: preview.id },
      };
    }
    return {
      success: false,
      output: `${applied.notice} ${applied.safeToReturnToAsk ? "Stayed in ASK." : "ASK remains active; explicit AGENT authority is required for recovery."}`,
      metadata: { type: "execution_handoff", choice, previewDecision: "apply", previewId: preview.id, previewStatus: applied.status },
    };
  }

  if (reviewChoice === "discard") {
    const discarded = await manager.discard(preview.id);
    return {
      success: discarded.ok,
      output: discarded.notice,
      metadata: { type: "execution_handoff", choice, previewDecision: "discard", previewId: preview.id },
    };
  }

  const kept = manager.keep(preview.id);
  return {
    success: true,
    output: `Preview kept: ${kept.path}\nCleanup: ${kept.cleanupCommand}\nStayed in ASK.`,
    metadata: { type: "execution_handoff", choice, previewDecision: "keep", previewId: preview.id },
  };
}

export const executionHandoffTool = Tool.define(
  "execution_handoff",
  DESCRIPTION,
  HandoffSchema,
  async (input): Promise<ToolResult> => {
    if (getCurrentMode() !== "ASK") {
      return { success: false, output: "Execution handoff is only needed in ASK." };
    }
    if (pending) {
      return { success: false, output: "An execution handoff is already awaiting direct user input." };
    }
    const runtime = currentExecutionContext()?.runtime;
    if (runtime) {
      return runtimeExecutionHandoff(runtime, input);
    }
    const id = randomUUID();
    const choice = await new Promise<ExecutionHandoffChoice>((resolve) => {
      pending = { id, resolve };
      Bus.publish(ExecutionHandoffEvents.Asked, {
        id,
        request: input.request,
        description: input.description,
        choices: ["Preview safely", "Switch to AGENT", "Stay in ASK"],
        recommended: "Preview safely",
      });
    });
    return {
      success: true,
      output: `Direct user choice: ${choiceLabel(choice)}.`,
      metadata: { type: "execution_handoff", choice, handoffId: id },
    };
  }
);
