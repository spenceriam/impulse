import { describe, expect, test } from "bun:test";
import {
  buildFailureReport,
  clusterFailures,
  formatFailureReport,
  isHarnessBottleneck,
  normalizeErrorSignature,
} from "../src/harness/failure-clusters.js";
import { TRACE_SCHEMA_VERSION, type TraceRecord } from "../src/harness/trace.js";

function record(opts: {
  turn: number;
  model?: string;
  tools?: TraceRecord["steps"]["tools"];
  outcome?: TraceRecord["outcome"];
  error?: string;
  failingTool?: string;
}): TraceRecord {
  return {
    schema: TRACE_SCHEMA_VERSION,
    turn: opts.turn,
    timestamp: new Date().toISOString(),
    mode: "WORK",
    model: opts.model ?? "model-a",
    input: { messageCount: 3 },
    steps: { tools: opts.tools ?? [], permissions: [] },
    outcome: opts.outcome ?? "success",
    ...(opts.error ? { error: opts.error } : {}),
    ...(opts.failingTool ? { failingTool: opts.failingTool } : {}),
  };
}

describe("normalizeErrorSignature", () => {
  test("collapses volatile parts so the same failure groups together", () => {
    const a = normalizeErrorSignature("ETIMEDOUT after 1200ms at /home/a/proj/x.ts");
    const b = normalizeErrorSignature("ETIMEDOUT after 9800ms at /home/b/proj/x.ts");
    expect(a).toBe(b);
  });

  test("missing error text is explicit, not empty", () => {
    expect(normalizeErrorSignature(undefined)).toBe("(no error text)");
  });
});

describe("clusterFailures", () => {
  test("groups repeated failures by tool and signature", () => {
    const records = [
      record({ turn: 1, tools: [{ name: "file_edit", outcome: "failed", error: "patch rejected" }] }),
      record({ turn: 2, tools: [{ name: "file_edit", outcome: "failed", error: "patch rejected" }] }),
      record({ turn: 3, tools: [{ name: "file_edit", outcome: "failed", error: "patch rejected" }] }),
      record({ turn: 4, tools: [{ name: "bash", outcome: "success" }] }),
    ];
    const clusters = clusterFailures(records);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.tool).toBe("file_edit");
    expect(clusters[0]!.count).toBe(3);
    expect(clusters[0]!.turns).toEqual([1, 2, 3]);
  });

  test("a cluster spanning models ranks above a single-model one at equal count", () => {
    const records = [
      record({ turn: 1, model: "a", tools: [{ name: "bash", outcome: "failed", error: "E1" }] }),
      record({ turn: 2, model: "b", tools: [{ name: "bash", outcome: "failed", error: "E1" }] }),
      record({ turn: 3, model: "a", tools: [{ name: "read", outcome: "failed", error: "E2" }] }),
      record({ turn: 4, model: "a", tools: [{ name: "read", outcome: "failed", error: "E2" }] }),
    ];
    const clusters = clusterFailures(records);
    expect(clusters[0]!.tool).toBe("bash");
    expect(clusters[0]!.models).toEqual(["a", "b"]);
  });

  test("turn-level failure with no failing tool is still clustered", () => {
    const records = [record({ turn: 1, outcome: "failed", error: "model returned empty", failingTool: "stream" })];
    const clusters = clusterFailures(records);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.tool).toBe("stream");
  });
});

describe("failure report", () => {
  test("renders totals and clusters", () => {
    const records = [
      record({ turn: 1, tools: [{ name: "bash", outcome: "failed", error: "timeout" }] }),
      record({ turn: 2 }),
    ];
    const lines = formatFailureReport(buildFailureReport(records));
    expect(lines[0]).toBe("2 turns · 1 failed (50%)");
    expect(lines.join("\n")).toContain("1× bash — timeout");
  });

  test("empty trace set says so instead of dividing by zero", () => {
    const lines = formatFailureReport(buildFailureReport([]));
    expect(lines[0]).toContain("No trace records yet");
  });
});

describe("isHarnessBottleneck", () => {
  test("needs recurrence and more than one model", () => {
    const single = { tool: "bash", signature: "x", count: 5, turns: [1], models: ["a"] };
    const multi = { tool: "bash", signature: "x", count: 5, turns: [1], models: ["a", "b"] };
    const rare = { tool: "bash", signature: "x", count: 1, turns: [1], models: ["a", "b"] };
    expect(isHarnessBottleneck(single)).toBe(false);
    expect(isHarnessBottleneck(multi)).toBe(true);
    expect(isHarnessBottleneck(rare)).toBe(false);
  });
});
