import { isTaskMetadata, type ToolMetadata } from "../types/tool-metadata";
import type { ToolCallInfo, ValidationSummary } from "./components/MessageBlock";

export function createSelfCheckSummary(toolCalls: ToolCallInfo[]): ValidationSummary {
  const findings: string[] = [];
  const nextSteps: string[] = [];

  if (toolCalls.length === 0) {
    findings.push("No tools were executed.");
    nextSteps.push("Confirm response quality before continuing.");
    return { findings, nextSteps };
  }

  const successCount = toolCalls.filter((toolCall) => toolCall.status === "success").length;
  const errorCount = toolCalls.filter((toolCall) => toolCall.status === "error").length;
  const cancelledCount = toolCalls.filter((toolCall) => toolCall.status === "cancelled").length;
  const runningCount = toolCalls.filter((toolCall) => toolCall.status === "pending" || toolCall.status === "running").length;

  findings.push(
    `Tool execution summary: ${successCount} success, ${errorCount} error, ${cancelledCount} cancelled, ${runningCount} in-flight.`
  );

  for (const toolCall of toolCalls) {
    const meta = toolCall.metadata as ToolMetadata | undefined;
    if (meta && isTaskMetadata(meta)) {
      const actionCount = meta.actions.length;
      findings.push(
        `Subagent (${meta.subagentType}) "${meta.description}": ${toolCall.status}, ${actionCount}/${meta.toolCallCount} actions recorded.`
      );
      if (actionCount === 0) {
        findings.push(`Subagent "${meta.description}" returned without recorded actions.`);
      }
      continue;
    }

    if (toolCall.status === "error" || toolCall.status === "cancelled") {
      const reason = toolCall.result?.trim();
      if (reason) {
        const snippet = reason.length > 120 ? `${reason.slice(0, 117)}...` : reason;
        findings.push(`${toolCall.name}: ${toolCall.status} (${snippet})`);
      } else {
        findings.push(`${toolCall.name}: ${toolCall.status}`);
      }
      continue;
    }

    findings.push(`${toolCall.name}: ${toolCall.status}`);
  }

  const hasFailure = toolCalls.some((toolCall) => toolCall.status === "error" || toolCall.status === "cancelled");
  const hasRunning = toolCalls.some((toolCall) => toolCall.status === "pending" || toolCall.status === "running");
  const hasSubagent = toolCalls.some((toolCall) => {
    const metadata = toolCall.metadata as ToolMetadata | undefined;
    return !!metadata && isTaskMetadata(metadata);
  });

  if (hasFailure) {
    nextSteps.push("Review failed/cancelled tools and retry with corrected inputs.");
  }
  if (hasRunning) {
    nextSteps.push("Wait for in-flight tools before finalizing this turn.");
  }
  if (hasSubagent) {
    nextSteps.push("Review subagent action summaries and verify delegated outcomes.");
  }
  if (!hasFailure && !hasRunning) {
    nextSteps.push("Validate file/tool outputs and continue.");
  }

  return { findings, nextSteps };
}
