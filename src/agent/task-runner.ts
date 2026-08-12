import { isAbsolute, relative, resolve } from "path";
import { Bus } from "../bus/bus";
import { SubagentEvents } from "../bus/events";
import type { TaskActionEntry } from "../types/tool-metadata.js";
import { getProviderManager } from "../api/manager";
import type { CompletionOptions } from "../api/provider";
import { getSubagentPrompt, getSubagentTools } from "./prompts";
import type { ToolDefinition } from "../api/types";
import { Tool } from "../tools/registry";
import { formatDurationMs } from "../cli/format-helpers.js";
import {
  SUBAGENT_PROGRESS_THINKING,
  SUBAGENT_PROGRESS_THINKING_PLACEHOLDER,
  SUBAGENT_PROGRESS_WRAPPING_UP,
} from "../cli/subagent-progress-labels.js";
import type { ChatMessage } from "../api/types";
import { canContinueAgentExecution } from "../session/turn-execution.js";
import { executionCwd } from "../execution/context.js";

/** Subagent tool loop cap (each iteration = one model completion + tool batch). */
export const SUBAGENT_MAX_ITERATIONS = 150;

/** Type-specific iteration caps (explore vs general). */
export function subagentMaxIterations(type: SubagentType): number {
  return type === "explore" ? 40 : 80;
}

export type SubagentType = "explore" | "general";
export type Thoroughness = "quick" | "medium" | "thorough";

function getThoroughnessInstructions(level: Thoroughness): string {
  switch (level) {
    case "quick":
      return `
THOROUGHNESS: QUICK
- Do 1-2 targeted searches maximum
- Return first relevant findings
- Don't explore tangential paths
- Prioritize speed over completeness`;
    case "medium":
      return `
THOROUGHNESS: MEDIUM (default)
- Do 3-5 searches as needed
- Follow up on promising leads
- Cover main patterns but don't exhaustively search
- Balance speed and completeness`;
    case "thorough":
      return `
THOROUGHNESS: THOROUGH
- Do comprehensive search across the codebase
- Check multiple directories and naming conventions
- Follow all relevant paths
- Ensure nothing is missed
- Take time to be complete`;
    default:
      return "";
  }
}

function formatArgForDisplay(value: string): string {
  const cwd = executionCwd();
  if (isAbsolute(value)) {
    const rel = relative(cwd, resolve(value));
    if (rel && !rel.startsWith("..")) {
      return rel.startsWith(".") ? rel : `./${rel}`;
    }
  }
  return value;
}

export function extractArgSummary(args: Record<string, unknown>): string {
  const keys = ["path", "filePath", "file", "command", "pattern", "query"];
  for (const key of keys) {
    if (args[key]) {
      return formatArgForDisplay(String(args[key]));
    }
  }
  return "";
}

export function formatSubagentToolLabel(toolName: string, args: Record<string, unknown>): string {
  const argSummary = extractArgSummary(args);
  return `${toolName}${argSummary ? ` ${argSummary}` : ""}`;
}

export type SubagentRunResult = {
  success: boolean;
  output: string;
  summary: string[];
  actions: TaskActionEntry[];
};

export type ExecuteSubagentOptions = {
  parentToolCallId: string;
  signal?: AbortSignal;
  /** API reasoning enabled for this subagent run. */
  subagentReasoningCapable?: boolean;
  /** When true, show thinking...; when false, Thinking... placeholder. */
  showSubagentThinkingDetail?: boolean;
  model?: string;
};

export type SubagentPreCompleteProgress = {
  type: "thinking" | "status";
  content: string;
};

/** Resolve progress line to show before the next sub-agent completion call. */
export function resolvePreCompleteProgress(
  messages: ChatMessage[],
  reasoningCapable: boolean,
  showDetail: boolean
): SubagentPreCompleteProgress | null {
  if (!reasoningCapable) return null;

  const content = showDetail
    ? SUBAGENT_PROGRESS_THINKING
    : SUBAGENT_PROGRESS_THINKING_PLACEHOLDER;

  const last = messages[messages.length - 1];
  if (last?.role === "tool") {
    return { type: "thinking", content };
  }
  return { type: "thinking", content };
}

/** True when the sub-agent should publish a final wrapping-up line after complete(). */
export function shouldPublishFinalWrappingUp(
  messages: ChatMessage[],
  hasToolCalls: boolean
): boolean {
  if (hasToolCalls) return false;
  return messages[messages.length - 1]?.role === "tool";
}

/**
 * Run a subagent conversation loop (non-streaming). Publishes progress on the bus.
 */
export async function executeSubagent(
  type: SubagentType,
  prompt: string,
  _description: string,
  thoroughness: Thoroughness | undefined,
  options: ExecuteSubagentOptions
): Promise<SubagentRunResult> {
  const { parentToolCallId, signal } = options;

  let systemPrompt = getSubagentPrompt(type);

  if (type === "explore" && thoroughness) {
    systemPrompt += getThoroughnessInstructions(thoroughness);
  }

  const allowedToolNames = getSubagentTools(type);
  const allTools = Tool.getAPIDefinitions();
  const filteredTools: ToolDefinition[] = allTools.filter((t) =>
    allowedToolNames.includes(t.function.name)
  );

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];

  const actionSummary: string[] = [];
  const actionEntries: TaskActionEntry[] = [];
  const manager = await getProviderManager();

  const publish = (payload: {
    type: "text" | "tool" | "thinking" | "status";
    content: string;
    durationMs?: number;
  }) => {
    Bus.publish(SubagentEvents.Progress, {
      ...payload,
      parentToolCallId,
    });
  };

  const reasoningCapable = options.subagentReasoningCapable ?? false;
  const showDetail = options.showSubagentThinkingDetail ?? true;

  const maxIterations = subagentMaxIterations(type);
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (signal?.aborted) {
      return {
        success: false,
        output: "Subagent aborted",
        summary: actionSummary,
        actions: actionEntries,
      };
    }

    const inferenceStart = Date.now();
    const preComplete = resolvePreCompleteProgress(messages, reasoningCapable, showDetail);
    const publishedThinking = preComplete?.type === "thinking";
    if (preComplete) {
      publish({ type: preComplete.type, content: preComplete.content });
    }

    const afterTools = messages[messages.length - 1]?.role === "tool";

    const completionOptions: CompletionOptions = {
      messages,
      ...(signal !== undefined ? { signal } : {}),
    };
    if (options.model?.trim()) {
      completionOptions.model = options.model.trim();
    }
    if (filteredTools.length > 0) {
      completionOptions.tools = filteredTools;
    }

    const response = await manager.complete(completionOptions);

    if (signal && !canContinueAgentExecution(signal)) {
      return {
        success: false,
        output: "Subagent aborted",
        summary: actionSummary,
        actions: actionEntries,
      };
    }

    if (publishedThinking) {
      publish({
        type: "status",
        content: `Thought for ${formatDurationMs(Date.now() - inferenceStart)}`,
      });
    }

    const choice = response.choices[0];
    if (!choice) {
      return {
        success: false,
        output: "No response from model",
        summary: actionSummary,
        actions: actionEntries,
      };
    }

    const assistantMessage = choice.message;
    const assistantContent =
      typeof assistantMessage.content === "string"
        ? assistantMessage.content
        : assistantMessage.content === null
          ? ""
          : JSON.stringify(assistantMessage.content);

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: assistantContent,
      tool_calls: assistantMessage.tool_calls,
    };
    const reasoning = (
      assistantMessage as { reasoning_content?: string | null }
    ).reasoning_content;
    if (typeof reasoning === "string" && reasoning.trim()) {
      assistantMsg.reasoning_content = reasoning;
    }
    messages.push(assistantMsg);

    const hasToolCalls =
      choice.finish_reason === "tool_calls" && !!assistantMessage.tool_calls?.length;

    if (!hasToolCalls) {
      if (afterTools) {
        publish({ type: "status", content: SUBAGENT_PROGRESS_WRAPPING_UP });
      }

      const contentText =
        typeof assistantMessage.content === "string"
          ? assistantMessage.content
          : assistantMessage.content === null
            ? ""
            : JSON.stringify(assistantMessage.content);

      return {
        success: true,
        output: contentText,
        summary: actionSummary,
        actions: actionEntries,
      };
    }

    const toolResults: Array<{ tool_call_id: string; content: string }> = [];

    for (const toolCall of assistantMessage.tool_calls ?? []) {
      if (signal?.aborted) break;

      const toolName = toolCall.function.name;
      if (!allowedToolNames.includes(toolName)) {
        toolResults.push({
          tool_call_id: toolCall.id,
          content: `Error: Tool "${toolName}" is not allowed for ${type} subagent`,
        });
        continue;
      }

      try {
        const args = JSON.parse(toolCall.function.arguments || "{}");
        const label = formatSubagentToolLabel(toolName, args);
        const toolStart = Date.now();
        const result = await Tool.execute(toolName, args);
        const durationMs = Date.now() - toolStart;

        actionSummary.push(label);
        actionEntries.push({ label, durationMs });
        publish({ type: "tool", content: label, durationMs });

        toolResults.push({
          tool_call_id: toolCall.id,
          content: result.success ? result.output : `Error: ${result.output}`,
        });
        if (signal && !canContinueAgentExecution(signal)) break;
      } catch (error) {
        toolResults.push({
          tool_call_id: toolCall.id,
          content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    for (const result of toolResults) {
      messages.push({
        role: "tool",
        content: result.content,
        tool_call_id: result.tool_call_id,
      });
    }
  }

  return {
    success: false,
    output: `Subagent reached maximum iterations (${maxIterations}) without completing`,
    summary: actionSummary,
    actions: actionEntries,
  };
}
