import { z } from "zod";
import { randomUUID } from "crypto";
import { Bus } from "../bus/index.js";
import { ExecutionHandoffEvents } from "../bus/events.js";
import {
  currentExecutionContext,
  type RuntimeExecutionHooks,
} from "../execution/context.js";
import { getCurrentMode } from "./mode-state.js";
import { Tool, type ToolResult } from "./registry.js";

export type ExecutionHandoffChoice = "agent" | "stay";
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

The client—not the model—offers exactly Switch to AGENT or Stay in ASK. Use this when the user asks for project mutation or general/writing delegation while ASK is active. Never infer or replay the choice. Clients without interactive elicitation stay in ASK instead of blocking.`;

async function runtimeExecutionHandoff(
  runtime: RuntimeExecutionHooks,
  input: { request: string; description: string }
): Promise<ToolResult> {
  const answers = await runtime.requestQuestion({
    prompt: `${input.description}\n\nHow should Impulse handle this consequential request?`,
    choices: [
      { id: "agent", label: "Switch to AGENT", description: "Enable execution authority for this session." },
      { id: "stay", label: "Stay in ASK", description: "Keep the project read-only." },
    ],
  });
  const choice: ExecutionHandoffChoice = answers?.[0] === "agent" ? "agent" : "stay";

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
        choices: ["Switch to AGENT", "Stay in ASK"],
      });
    });
    return {
      success: true,
      output: `Direct user choice: ${choice === "agent" ? "Switch to AGENT" : "Stay in ASK"}.`,
      metadata: { type: "execution_handoff", choice, handoffId: id },
    };
  }
);
