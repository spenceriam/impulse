import { describe, expect, it } from "bun:test";
import { createSelfCheckSummary } from "../src/ui/self-check";
import type { ToolCallInfo } from "../src/ui/components/MessageBlock";

function tool(overrides: Partial<ToolCallInfo>): ToolCallInfo {
  return {
    id: overrides.id ?? "tc-1",
    name: overrides.name ?? "read",
    arguments: overrides.arguments ?? "{}",
    status: overrides.status ?? "success",
    ...(overrides.result ? { result: overrides.result } : {}),
    ...(overrides.metadata ? { metadata: overrides.metadata } : {}),
  };
}

describe("createSelfCheckSummary", () => {
  it("returns baseline findings when no tools were executed", () => {
    const summary = createSelfCheckSummary([]);

    expect(summary.findings).toEqual(["No tools were executed."]);
    expect(summary.nextSteps).toEqual(["Confirm response quality before continuing."]);
  });

  it("captures failure and running status in next steps", () => {
    const longError = "x".repeat(140);
    const summary = createSelfCheckSummary([
      tool({ id: "a", name: "read", status: "success" }),
      tool({ id: "b", name: "bash", status: "error", result: longError }),
      tool({ id: "c", name: "grep", status: "running" }),
      tool({ id: "d", name: "write", status: "cancelled" }),
    ]);

    expect(summary.findings[0]).toBe("Tool execution summary: 1 success, 1 error, 1 cancelled, 1 in-flight.");
    expect(summary.findings).toContain("read: success");
    expect(summary.findings.some((item) => item.startsWith("bash: error (") && item.endsWith("...)"))).toBe(true);
    expect(summary.findings).toContain("grep: running");
    expect(summary.findings).toContain("write: cancelled");
    expect(summary.nextSteps).toContain("Review failed/cancelled tools and retry with corrected inputs.");
    expect(summary.nextSteps).toContain("Wait for in-flight tools before finalizing this turn.");
    expect(summary.nextSteps).not.toContain("Validate file/tool outputs and continue.");
  });

  it("audits subagent task metadata and adds subagent verification step", () => {
    const summary = createSelfCheckSummary([
      tool({
        id: "subagent",
        name: "task",
        status: "success",
        metadata: {
          type: "task",
          subagentType: "general",
          description: "Refactor chat render pipeline",
          actions: ["inspected stream events", "updated message block rendering"],
          toolCallCount: 3,
        },
      }),
    ]);

    expect(summary.findings).toContain(
      'Subagent (general) "Refactor chat render pipeline": success, 2/3 actions recorded.'
    );
    expect(summary.nextSteps).toContain("Review subagent action summaries and verify delegated outcomes.");
    expect(summary.nextSteps).toContain("Validate file/tool outputs and continue.");
  });

  it("flags subagent responses that return without actions", () => {
    const summary = createSelfCheckSummary([
      tool({
        id: "subagent",
        name: "task",
        status: "success",
        metadata: {
          type: "task",
          subagentType: "explore",
          description: "Inspect tool call flow",
          actions: [],
          toolCallCount: 0,
        },
      }),
    ]);

    expect(summary.findings).toContain('Subagent "Inspect tool call flow" returned without recorded actions.');
  });
});
