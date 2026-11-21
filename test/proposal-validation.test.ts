import { describe, expect, test } from "bun:test";
import {
  formatValidatedProposals,
  splitRecords,
  validateProposals,
} from "../src/harness/proposal-validation.js";
import type { Proposal } from "../src/harness/proposals.js";
import { TRACE_SCHEMA_VERSION, type TraceRecord } from "../src/harness/trace.js";

function rec(opts: {
  turn: number;
  time: string;
  model?: string;
  error?: string;
  tool?: string;
}): TraceRecord {
  return {
    schema: TRACE_SCHEMA_VERSION,
    turn: opts.turn,
    timestamp: opts.time,
    mode: "WORK",
    model: opts.model ?? "model-a",
    input: { messageCount: 2 },
    steps: {
      tools: [
        {
          name: opts.tool ?? "file_edit",
          outcome: "failed",
          error: opts.error ?? "patch rejected",
        },
      ],
      permissions: [],
    },
    outcome: "failed",
  };
}

const proposal: Proposal = {
  id: "file_edit:tool-interface:patch rejected",
  area: "tool-interface",
  tool: "file_edit",
  signature: "patch rejected",
  count: 3,
  summary: "s",
  rationale: "r",
  where: ["src/tools/"],
  rank: 10,
};

describe("splitRecords", () => {
  test("splits chronologically, not by array position", () => {
    const records = [
      rec({ turn: 3, time: "2026-11-21T03:00:00Z" }),
      rec({ turn: 1, time: "2026-11-21T01:00:00Z" }),
      rec({ turn: 2, time: "2026-11-21T02:00:00Z" }),
      rec({ turn: 4, time: "2026-11-21T04:00:00Z" }),
    ];
    const { baseline, heldOut } = splitRecords(records);
    expect(baseline.map((r) => r.turn)).toEqual([1, 2]);
    expect(heldOut.map((r) => r.turn)).toEqual([3, 4]);
  });

  test("a single record has no held-out half", () => {
    const { baseline, heldOut } = splitRecords([rec({ turn: 1, time: "2026-11-21T01:00:00Z" })]);
    expect(baseline).toHaveLength(1);
    expect(heldOut).toHaveLength(0);
  });
});

describe("validateProposals", () => {
  test("signature gone from the recent half is already fixed", () => {
    const records = [
      rec({ turn: 1, time: "2026-11-21T01:00:00Z" }),
      rec({ turn: 2, time: "2026-11-21T02:00:00Z" }),
      // recent half: a different failure
      rec({ turn: 3, time: "2026-11-21T03:00:00Z", error: "timeout" }),
      rec({ turn: 4, time: "2026-11-21T04:00:00Z", error: "timeout" }),
    ];
    const [v] = validateProposals([proposal], records);
    expect(v!.verdict).toBe("already-fixed");
    expect(v!.score).toBe(0);
  });

  test("recurring across models in the recent half is supported", () => {
    const records = [
      rec({ turn: 1, time: "2026-11-21T01:00:00Z", model: "a" }),
      rec({ turn: 2, time: "2026-11-21T02:00:00Z", model: "a" }),
      rec({ turn: 3, time: "2026-11-21T03:00:00Z", model: "a" }),
      rec({ turn: 4, time: "2026-11-21T04:00:00Z", model: "b" }),
    ];
    const [v] = validateProposals([proposal], records);
    expect(v!.verdict).toBe("supported");
    expect(v!.heldOutCount).toBe(2);
    expect(v!.modelsInHeldOut).toBe(2);
  });

  test("single recurrence in the recent half is weak", () => {
    const records = [
      rec({ turn: 1, time: "2026-11-21T01:00:00Z" }),
      rec({ turn: 2, time: "2026-11-21T02:00:00Z" }),
      rec({ turn: 3, time: "2026-11-21T03:00:00Z" }),
      rec({ turn: 4, time: "2026-11-21T04:00:00Z", error: "other" }),
    ];
    const [v] = validateProposals([proposal], records);
    expect(v!.verdict).toBe("weak");
  });

  test("same records always produce the same verdict", () => {
    const records = [
      rec({ turn: 1, time: "2026-11-21T01:00:00Z" }),
      rec({ turn: 2, time: "2026-11-21T02:00:00Z", model: "b" }),
    ];
    const a = validateProposals([proposal], records);
    const b = validateProposals([proposal], records);
    expect(a).toEqual(b);
  });

  test("supported proposals rank above already-fixed ones", () => {
    const records = [
      rec({ turn: 1, time: "2026-11-21T01:00:00Z", tool: "bash", error: "timeout" }),
      rec({ turn: 2, time: "2026-11-21T02:00:00Z", tool: "bash", error: "timeout" }),
      // recent half: file_edit recurs across models, bash's timeout is gone
      rec({ turn: 3, time: "2026-11-21T03:00:00Z", model: "a" }),
      rec({ turn: 4, time: "2026-11-21T04:00:00Z", model: "b" }),
      rec({ turn: 5, time: "2026-11-21T05:00:00Z", model: "a" }),
    ];
    const bashProposal: Proposal = {
      ...proposal,
      id: "bash:loop-control:timeout",
      tool: "bash",
      signature: "timeout",
      area: "loop-control",
    };
    const result = validateProposals([bashProposal, proposal], records);
    const edit = result.find((v) => v.tool === "file_edit")!;
    const bash = result.find((v) => v.tool === "bash")!;
    expect(edit.verdict).toBe("supported");
    expect(bash.verdict).toBe("already-fixed");
    expect(result[0]!.tool).toBe("file_edit");
  });
});

describe("formatValidatedProposals", () => {
  test("counts each verdict", () => {
    const lines = formatValidatedProposals(
      validateProposals([proposal], [
        rec({ turn: 1, time: "2026-11-21T01:00:00Z" }),
        rec({ turn: 2, time: "2026-11-21T02:00:00Z" }),
      ])
    );
    expect(lines[0]).toContain("already fixed");
  });

  test("empty input says so", () => {
    expect(formatValidatedProposals([])[0]).toContain("No proposals");
  });
});
