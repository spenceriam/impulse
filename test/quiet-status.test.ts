import { describe, expect, test } from "bun:test";
import {
  QuietWorkGroupTracker,
  classifyQuietOutcome,
  extractOpenPlanItem,
  formatQuietLiveStatus,
  formatQuietRecap,
  formatWorkedFor,
  isQuietBreakOutcome,
  lastFailureNextLabel,
  pickQuietRecapNext,
  quietThinkingPhrase,
  shortQuietArg,
  wrapQuietRecapLines,
} from "../src/cli/quiet-status.js";

describe("quiet-status", () => {
  test("templated tool verb + short arg", () => {
    expect(
      formatQuietLiveStatus({
        tools: [{ id: "1", name: "file_read", arg: "AGENTS.md" }],
      })
    ).toBe("Reading AGENTS.md…");
  });

  test("parallel tools coalesce with (+N)", () => {
    expect(
      formatQuietLiveStatus({
        tools: [
          { id: "1", name: "file_read", arg: "AGENTS.md" },
          { id: "2", name: "grep", arg: "foo" },
          { id: "3", name: "ls", arg: "src" },
        ],
      })
    ).toBe("Reading AGENTS.md… (+2)");
  });

  test("thinking phrases are fixed set", () => {
    expect(quietThinkingPhrase("assessing")).toBe("Assessing…");
    expect(quietThinkingPhrase("planning")).toBe("Planning…");
    expect(
      formatQuietLiveStatus({ thinking: "assessing", tools: [] })
    ).toBe("Assessing…");
  });

  test("Worked for uses ms under 1s and whole seconds at/above 1s", () => {
    expect(formatWorkedFor(0)).toBe("Worked for 0ms");
    expect(formatWorkedFor(340)).toBe("Worked for 340ms");
    expect(formatWorkedFor(999)).toBe("Worked for 999ms");
    expect(formatWorkedFor(1000)).toBe("Worked for 1s");
    expect(formatWorkedFor(1500)).toBe("Worked for 2s");
    expect(formatWorkedFor(10400)).toBe("Worked for 10s");
  });

  test("shortQuietArg uses basename for paths", () => {
    expect(shortQuietArg("file_read", { path: "src/cli/renderer.ts" })).toBe(
      "renderer.ts"
    );
    expect(shortQuietArg("bash", { command: "ls -la" })).toBe("ls -la");
  });

  test("failed/blocked outcomes break Quiet", () => {
    expect(
      isQuietBreakOutcome(
        classifyQuietOutcome({ success: false, output: "permission denied" })
      )
    ).toBe(true);
    expect(
      isQuietBreakOutcome(
        classifyQuietOutcome({ success: false, output: "ENOENT" })
      )
    ).toBe(true);
    expect(
      isQuietBreakOutcome(
        classifyQuietOutcome({ success: true, output: "ok" })
      )
    ).toBe(false);
  });

  test("Recap done→next: outcome facts + ✓ when all succeed", () => {
    const line = formatQuietRecap([
      { name: "file_edit", arg: "auth.ts", outcome: "success" },
      { name: "bash", arg: "tests", outcome: "success" },
    ]);
    expect(line).toBe("Recap: edited auth.ts, ran tests ✓");
  });

  test("Recap done→next: appends Next from pending todo", () => {
    const line = formatQuietRecap(
      [
        { name: "file_edit", arg: "auth.ts", outcome: "success" },
        { name: "bash", arg: "tests", outcome: "success" },
      ],
      { pendingTodo: "token-refresh test" }
    );
    expect(line).toBe("Recap: edited auth.ts, ran tests ✓ · Next: token-refresh test");
  });

  test("Recap omits Next when no next signal", () => {
    const line = formatQuietRecap([
      { name: "file_read", arg: "AGENTS.md", outcome: "success" },
    ]);
    expect(line).toBe("Recap: read AGENTS.md ✓");
    expect(line).not.toContain("Next:");
  });

  test("Recap Next prefers todo over last failure", () => {
    const line = formatQuietRecap(
      [
        { name: "bash", arg: "bun test", outcome: "failed" },
      ],
      { pendingTodo: "fix CI", lastFailure: "retry bun test" }
    );
    expect(line).toBe("Recap: ran bun test failed · Next: fix CI");
  });

  test("Recap Next falls back to last failure then plan item", () => {
    expect(
      pickQuietRecapNext({
        pendingTodo: null,
        lastFailure: "retry bun test",
        openPlanItem: "ship Quiet",
      })
    ).toBe("retry bun test");
    expect(
      pickQuietRecapNext({
        pendingTodo: null,
        lastFailure: null,
        openPlanItem: "ship Quiet",
      })
    ).toBe("ship Quiet");
    expect(pickQuietRecapNext({})).toBeNull();
  });

  test("lastFailureNextLabel and extractOpenPlanItem are event-sourced", () => {
    expect(
      lastFailureNextLabel([
        { name: "file_edit", arg: "a.ts", outcome: "success" },
        { name: "bash", arg: "bun test", outcome: "failed" },
      ])
    ).toBe("retry bun test");
    expect(extractOpenPlanItem("- [x] done\n- [ ] token-refresh test\n")).toBe(
      "token-refresh test"
    );
    expect(extractOpenPlanItem("- [x] all done\n")).toBeNull();
  });

  test("Recap includes blocked tools without inventing Next", () => {
    const line = formatQuietRecap([
      { name: "bash", arg: "rm -rf /", outcome: "blocked" },
    ], { lastFailure: null, pendingTodo: null, openPlanItem: null });
    // Explicit nulls suppress auto lastFailure — no Next invented
    expect(line).toBe("Recap: ran rm -rf / blocked");
    expect(line).not.toContain("Next:");
  });

  test("Recap auto-Next from failure when hints omitted", () => {
    const line = formatQuietRecap([
      { name: "bash", arg: "bun test", outcome: "failed" },
    ]);
    expect(line).toBe("Recap: ran bun test failed · Next: retry bun test");
  });

  test("Recap null when no events", () => {
    expect(formatQuietRecap([])).toBeNull();
  });

  test("Recap wrap is at most 3 lines with ellipsis", () => {
    const long = formatQuietRecap([
      { name: "file_read", arg: "a-very-long-filename-aaaaaaaa.md", outcome: "success" },
      { name: "file_edit", arg: "b-very-long-filename-bbbbbbbb.ts", outcome: "success" },
      { name: "grep", arg: "c-very-long-pattern-cccccccccc", outcome: "success" },
      { name: "bash", arg: "d-very-long-command-dddddddddd", outcome: "success" },
    ]);
    expect(long).not.toBeNull();
    const rows = wrapQuietRecapLines(long!, 24, 3);
    expect(rows.length).toBeLessThanOrEqual(3);
    expect(rows.length).toBe(3);
    expect(rows[2]!.endsWith("…")).toBe(true);
  });

  test("Recap wrap under max lines stays untruncated", () => {
    const rows = wrapQuietRecapLines("Recap: read AGENTS.md ✓", 80, 3);
    expect(rows).toEqual(["Recap: read AGENTS.md ✓"]);
  });
});

describe("QuietWorkGroupTracker settle-once", () => {
  test("settle emits one Worked for; second settle is null", () => {
    const t = new QuietWorkGroupTracker();
    const t0 = 1_000_000;
    t.addTool({ id: "1", name: "file_read", arg: "AGENTS.md" }, t0);
    t.removeTool("1");
    // Post-tool thinking stays in same group (no settle on tools-done).
    t.setThinking("planning", t0 + 100);

    const first = t.settle(t0 + 340);
    expect(first).not.toBeNull();
    expect(first!.workedForLine).toBe("Worked for 340ms");
    expect(t.settledCount).toBe(1);

    const second = t.settle(t0 + 500);
    expect(second).toBeNull();
    expect(t.settledCount).toBe(1);
  });

  test("tools then thinking then settle is still one Worked for", () => {
    const t = new QuietWorkGroupTracker();
    t.addTool({ id: "a", name: "file_read", arg: "AGENTS.md" });
    t.addTool({ id: "b", name: "ls", arg: "." });
    t.removeTool("a");
    t.removeTool("b");
    t.setThinking("planning");
    t.setThinking("planning");

    expect(t.settle(Date.now() + 50)).not.toBeNull();
    expect(t.settle()).toBeNull();
    expect(t.settledCount).toBe(1);
  });

  test("new group after settle can emit another Worked for", () => {
    const t = new QuietWorkGroupTracker();
    t.addTool({ id: "1", name: "file_read", arg: "a" });
    expect(t.settle()).not.toBeNull();

    t.markGapBeforeNextWorkedFor();
    t.addTool({ id: "2", name: "ls", arg: "." });
    expect(t.needsGapBeforeWorkedFor).toBe(true);
    expect(t.settle()).not.toBeNull();
    expect(t.settledCount).toBe(2);
    expect(t.consumeGapBeforeWorkedFor()).toBe(true);
    expect(t.consumeGapBeforeWorkedFor()).toBe(false);
  });

  test("idle ensure without activity does not settle", () => {
    const t = new QuietWorkGroupTracker();
    t.ensure();
    expect(t.settle()).toBeNull();
    expect(t.settledCount).toBe(0);
  });
});
