import type { ToolCallInfo } from "../types/tool-call";

export interface SelfCheckSummary {
  findings: string[];
  nextSteps: string[];
}

function truncate(value: string, max = 100): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

export function createSelfCheckSummary(tools: ToolCallInfo[]): SelfCheckSummary {
  if (tools.length === 0) {
    return {
      findings: ["No tools were executed."],
      nextSteps: ["Confirm response quality before continuing."],
    };
  }

  const counts = {
    success: tools.filter((tool) => tool.status === "success").length,
    error: tools.filter((tool) => tool.status === "error").length,
    cancelled: tools.filter((tool) => tool.status === "cancelled").length,
    running: tools.filter((tool) => tool.status === "running").length,
  };
  const findings = [
    `Tool execution summary: ${counts.success} success, ${counts.error} error, ${counts.cancelled} cancelled, ${counts.running} in-flight.`,
  ];
  const nextSteps = new Set<string>();

  for (const tool of tools) {
    const result = tool.result ? ` (${truncate(tool.result)})` : "";
    findings.push(`${tool.name}: ${tool.status}${result}`);

    if (tool.metadata?.["type"] === "task") {
      const subagentType = typeof tool.metadata["subagentType"] === "string" ? tool.metadata["subagentType"] : undefined;
      const description = typeof tool.metadata["description"] === "string" ? tool.metadata["description"] : undefined;
      const actions = Array.isArray(tool.metadata["actions"]) ? tool.metadata["actions"] : [];
      const toolCallCount = typeof tool.metadata["toolCallCount"] === "number" ? tool.metadata["toolCallCount"] : actions.length;

      if (actions.length === 0 && description) {
        findings.push(`Subagent "${description}" returned without recorded actions.`);
      } else if (subagentType && description) {
        findings.push(
          `Subagent (${subagentType}) "${description}": ${tool.status}, ${actions.length}/${toolCallCount} actions recorded.`
        );
      }
      nextSteps.add("Review subagent action summaries and verify delegated outcomes.");
    }
  }

  if (counts.error > 0 || counts.cancelled > 0) {
    nextSteps.add("Review failed/cancelled tools and retry with corrected inputs.");
  }
  if (counts.running > 0) {
    nextSteps.add("Wait for in-flight tools before finalizing this turn.");
  }
  if (counts.error === 0) {
    nextSteps.add("Validate file/tool outputs and continue.");
  }

  return { findings, nextSteps: [...nextSteps] };
}
