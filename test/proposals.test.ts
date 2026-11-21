import { describe, expect, test } from "bun:test";
import {
  classifyClusterArea,
  formatProposals,
  proposeFromClusters,
  proposeFromRecords,
} from "../src/harness/proposals.js";
import type { FailureCluster } from "../src/harness/failure-clusters.js";
import { TRACE_SCHEMA_VERSION, type TraceRecord } from "../src/harness/trace.js";

function cluster(over: Partial<FailureCluster> = {}): FailureCluster {
  return {
    tool: "file_edit",
    signature: "patch rejected",
    count: 3,
    turns: [1, 2, 3],
    models: ["model-a"],
    ...over,
  };
}

describe("classifyClusterArea", () => {
  test("malformed input maps to tool-repair", () => {
    expect(classifyClusterArea(cluster({ signature: "invalid json arguments" }))).toBe(
      "tool-repair"
    );
  });

  test("rejection maps to tool-interface", () => {
    expect(classifyClusterArea(cluster({ signature: "permission denied" }))).toBe(
      "tool-interface"
    );
  });

  test("timeout maps to loop-control", () => {
    expect(classifyClusterArea(cluster({ signature: "timed out after N" }))).toBe(
      "loop-control"
    );
  });

  test("unknown signature is conservative, not a guess", () => {
    expect(classifyClusterArea(cluster({ signature: "weird thing happened" }))).toBe(
      "verification"
    );
  });
});

describe("proposeFromClusters", () => {
  test("single failures are noise — no proposal", () => {
    expect(proposeFromClusters([cluster({ count: 1 })])).toEqual([]);
  });

  test("multi-model clusters outrank single-model ones", () => {
    const proposals = proposeFromClusters([
      cluster({ tool: "read", count: 5, models: ["a"] }),
      cluster({ tool: "bash", count: 3, models: ["a", "b"] }),
    ]);
    expect(proposals[0]!.tool).toBe("bash");
    expect(proposals[0]!.rationale).toContain("harness-level");
    expect(proposals[1]!.rationale).toContain("could be a model limit");
  });

  test("caps the number of proposals", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      cluster({ tool: `tool${i}`, signature: `sig${i}` })
    );
    expect(proposeFromClusters(many, { maxProposals: 3 })).toHaveLength(3);
  });

  test("proposals are propose-only text: they carry a location, never an edit", () => {
    const [p] = proposeFromClusters([cluster()]);
    expect(p!.where.length).toBeGreaterThan(0);
    expect(p!.summary).not.toMatch(/^apply|^edit /i);
  });
});

describe("proposeFromRecords", () => {
  test("goes from records to ranked proposals", () => {
    const rec = (turn: number, model: string): TraceRecord => ({
      schema: TRACE_SCHEMA_VERSION,
      turn,
      timestamp: new Date().toISOString(),
      mode: "WORK",
      model,
      input: { messageCount: 2 },
      steps: {
        tools: [
          { name: "file_edit", outcome: "failed", error: "patch rejected" },
        ],
        permissions: [],
      },
      outcome: "failed",
    });
    const proposals = proposeFromRecords([rec(1, "a"), rec(2, "b")]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.area).toBe("tool-interface");
  });
});

describe("formatProposals", () => {
  test("says nothing to do when empty", () => {
    expect(formatProposals([])[0]).toContain("No proposals");
  });

  test("states that nothing was applied", () => {
    const lines = formatProposals(proposeFromClusters([cluster()]));
    expect(lines[0]).toContain("propose-only");
  });
});
