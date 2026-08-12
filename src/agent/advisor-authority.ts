import type { ToolDefinition } from "../api/types.js";
import type { Mode } from "../constants.js";

export interface AdvisorAuthorityConfig {
  advisorMode?: boolean | undefined;
  advisorModel?: string | undefined;
  experimental?: { advisor?: boolean | undefined } | undefined;
}

export interface AdvisorInvocationResult<T> {
  executed: boolean;
  reason?: string;
  value?: T;
}

export type AdvisorInvocationSource =
  | "direct-model-dispatch"
  | "automatic-stuck-loop";

/** Shared authority predicate for every advisor execution entry point. */
export function isAdvisorExecutionAuthorized(
  mode: Mode,
  config: AdvisorAuthorityConfig
): boolean {
  return mode === "AGENT" &&
    config.advisorMode === true &&
    Boolean(config.advisorModel?.trim()) &&
    config.experimental?.advisor === true;
}

export function getAdvisorToolDefinitionForMode(
  mode: Mode,
  config: AdvisorAuthorityConfig
): ToolDefinition | null {
  if (!isAdvisorExecutionAuthorized(mode, config)) return null;

  return {
    type: "function",
    function: {
      name: "consult_advisor",
      description:
        "Consult the strategic advisor before mutating work. Include an **Executor draft** in context (your approach). " +
        "Returns plan_markdown in the tool result — do NOT file_read the plan path. " +
        "MUST be called before file writes, edits, non-readonly bash, or subagent launches.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "Brief topic for the plan filename (3-8 words, e.g. 'refactor-auth-module')",
          },
          context: {
            type: "string",
            description:
              "Full context plus **Executor draft**: your reasoning, proposed approach, and what you need from the advisor",
          },
          type: {
            type: "string",
            enum: ["plan", "advisory"],
            description: "'plan' for new work / greenfield builds. 'advisory' for course corrections / error recovery",
          },
        },
        required: ["topic", "context"],
      },
    },
  };
}

export async function invokeAdvisorForMode<T>(input: {
  mode: Mode;
  config: AdvisorAuthorityConfig;
  source: AdvisorInvocationSource;
  invoke: () => Promise<T>;
}): Promise<AdvisorInvocationResult<T>> {
  if (
    input.source !== "direct-model-dispatch" &&
    input.source !== "automatic-stuck-loop"
  ) {
    return { executed: false, reason: "Advisor invocation source is not authorized." };
  }
  if (!isAdvisorExecutionAuthorized(input.mode, input.config)) {
    const reason = input.mode === "ASK"
      ? "Advisor execution is unavailable in ASK. Ask the user to switch to AGENT before consulting the advisor."
      : "Advisor execution requires the advisor workflow, model, and experimental feature configuration.";
    return { executed: false, reason };
  }

  return { executed: true, value: await input.invoke() };
}
