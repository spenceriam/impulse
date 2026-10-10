import { describe, expect, test } from "bun:test";
import path from "path";
import {
  QuietWorkGroupTracker,
  buildQuietRecapFact,
  classifyQuietOutcome,
  deriveIntentFromThinking,
  extractOpenPlanItem,
  formatDuration,
  formatQuietLiveStatus,
  formatQuietRecap,
  formatWorkedFor,
  isQuietBreakOutcome,
  isVagueRecapNoun,
  lastFailureNextLabel,
  pickQuietRecapNext,
  quietThinkingPhrase,
  shortQuietArg,
  unansweredAskNextLabel,
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

  test("live narration carries a ticking elapsed time", () => {
    expect(
      formatQuietLiveStatus({
        tools: [{ id: "1", name: "file_read", arg: "AGENTS.md" }],
        elapsedMs: 4_200,
      })
    ).toBe("Reading AGENTS.md… (4s)");
    expect(
      formatQuietLiveStatus({
        thinking: "assessing",
        tools: [],
        elapsedMs: 340,
      })
    ).toBe("Assessing… (340ms)");
  });

  test("intent phrase narrates the thinking phase", () => {
    expect(
      formatQuietLiveStatus({
        thinking: "assessing",
        thinkingIntent: "review the codebase and README",
        tools: [],
        elapsedMs: 2_000,
      })
    ).toBe("Planning to review the codebase and README… (2s)");
    expect(
      formatQuietLiveStatus({
        thinking: "planning",
        thinkingIntent: "how to fix the wrap width",
        tools: [],
        elapsedMs: 3_000,
      })
    ).toBe("Thinking about how to fix the wrap width… (3s)");
  });

  test("intent derives from the reasoning stream; <intent> marker wins", () => {
    const t = new QuietWorkGroupTracker();
    const t0 = 1_000_000;
    t.setThinking("assessing", t0);
    t.noteThinkingText("I need to review");
    expect(t.thinkingIntent).toBeNull(); // not enough words yet
    t.noteThinkingText(" the codebase and README before touching the renderer.");
    expect(t.thinkingIntent).toBe("review the codebase and README before touching the");
    t.setThinkingIntent("check the quiet narration path");
    expect(t.thinkingIntent).toBe("check the quiet narration path");
  });

  test("deriveIntentFromThinking strips filler and caps words", () => {
    expect(deriveIntentFromThinking("Let me look at the auth module tests first.")).toBe(
      "look at the auth module tests first"
    );
    expect(deriveIntentFromThinking("short")).toBeNull();
    expect(deriveIntentFromThinking("one two three")).toBeNull();
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

  test("durations roll into minutes past 60s (never a bare second count)", () => {
    expect(formatWorkedFor(65_000)).toBe("Worked for 1 min 5s");
    expect(formatWorkedFor(72_000)).toBe("Worked for 1 min 12s");
    expect(formatWorkedFor(120_000)).toBe("Worked for 2 min");
    expect(formatDuration(61_000)).toBe("1 min 1s");
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

  test("buildQuietRecapFact: plain-language outcomes (no tool-call echo)", () => {
    // Root / cwd basename → "the project folder" (never folder-name mush)
    expect(
      buildQuietRecapFact("ls", ".", {
        success: true,
        output: "ok",
        metadata: { type: "ls", totalEntries: 27, entryCount: 27, truncated: false },
      })
    ).toBe("looked through the project folder (27 items)");
    expect(
      buildQuietRecapFact("ls", path.basename(process.cwd()), {
        success: true,
        output: "ok",
        metadata: {
          type: "ls",
          path: process.cwd(),
          totalEntries: 27,
          entryCount: 27,
          truncated: false,
        },
      })
    ).toBe("looked through the project folder (27 items)");
    expect(
      buildQuietRecapFact("ls", "src", {
        success: true,
        output: "ok",
        metadata: {
          type: "ls",
          path: "src",
          totalEntries: 10,
          entryCount: 10,
          truncated: false,
        },
      })
    ).toBe("looked through src (10 items)");
    expect(
      buildQuietRecapFact("file_read", "AGENTS.md", {
        success: true,
        output: "ok",
        metadata: { type: "file_read", linesRead: 120 },
      })
    ).toBe("reviewed AGENTS.md");
    expect(
      buildQuietRecapFact("grep", "Recap", {
        success: true,
        output: "ok",
        metadata: { type: "grep", pattern: "Recap", matchCount: 5 },
      })
    ).toBe("found 5 matches for Recap");
    // Common shell commands map to plain intent, not raw command echo
    expect(
      buildQuietRecapFact("bash", "bun test", {
        success: true,
        output: "ok",
        metadata: { type: "bash", command: "bun test" },
      })
    ).toBe("ran the tests");
    expect(
      buildQuietRecapFact("bash", "git log", {
        success: true,
        output: "ok",
        metadata: { type: "bash", command: "git log --oneline -20" },
      })
    ).toBe("reviewed recent changes");
    // Unknown command keeps the concrete command
    expect(
      buildQuietRecapFact("bash", "wibblesort --mode 7", {
        success: true,
        output: "ok",
        metadata: { type: "bash", command: "wibblesort --mode 7" },
      })
    ).toBe("ran wibblesort --mode 7");
    // Vague / no-metadata → null (skip mush)
    expect(
      buildQuietRecapFact("ls", "impulse-pr154", { success: true, output: "ok" })
    ).toBeNull();
    expect(isVagueRecapNoun("looking at files")).toBe(true);
    expect(isVagueRecapNoun("AGENTS.md")).toBe(false);
  });

  test("Recap facts are specific + semicolon-joined + ✓ when all succeed", () => {
    const line = formatQuietRecap([
      {
        name: "file_read",
        arg: "AGENTS.md",
        outcome: "success",
        fact: "read AGENTS.md (120 lines)",
      },
      {
        name: "ls",
        arg: ".",
        outcome: "success",
        fact: "listed 27 top-level entries",
      },
      {
        name: "bash",
        arg: "bun test",
        outcome: "success",
        fact: "ran bun test",
      },
    ]);
    expect(line).toBe(
      "Recap: read AGENTS.md (120 lines); listed 27 top-level entries; ran bun test ✓"
    );
    expect(line).not.toMatch(/looking at|working on|listing things/i);
  });

  test("Recap done→next: Next only when open work (pending todo)", () => {
    const line = formatQuietRecap(
      [
        {
          name: "file_edit",
          arg: "auth.ts",
          outcome: "success",
          fact: "edited auth.ts",
        },
        {
          name: "bash",
          arg: "bun test",
          outcome: "success",
          fact: "ran bun test",
        },
      ],
      { pendingTodo: "token-refresh test" }
    );
    expect(line).toBe(
      "Recap: edited auth.ts; ran bun test ✓ · Next: token-refresh test"
    );
  });

  test("Recap omits Next when turn complete (no open work)", () => {
    const line = formatQuietRecap(
      [
        {
          name: "file_read",
          arg: "AGENTS.md",
          outcome: "success",
          fact: "read AGENTS.md",
        },
      ],
      {
        pendingTodo: null,
        lastFailure: null,
        unansweredAsk: null,
        openPlanItem: null,
      }
    );
    expect(line).toBe("Recap: read AGENTS.md ✓");
    expect(line).not.toContain("Next:");
  });

  test("Recap skips vague facts; coalesces multiple file reads", () => {
    const line = formatQuietRecap([
      { name: "file_read", arg: "AGENTS.md", outcome: "success" },
      { name: "file_read", arg: "quiet-status.ts", outcome: "success" },
      { name: "todo_write", arg: "", outcome: "success" }, // skipped
      {
        name: "ls",
        arg: "impulse-pr154",
        outcome: "success",
        // no fact + vague path alone would be mush — with fact it's concrete
        fact: "looked through the project folder (27 items)",
      },
    ]);
    expect(line).toBe(
      "Recap: reviewed AGENTS.md, quiet-status.ts; looked through the project folder (27 items) ✓"
    );
  });

  test("Recap Next prefers todo over failure over unanswered ask over plan", () => {
    expect(
      pickQuietRecapNext({
        pendingTodo: "fix CI",
        lastFailure: "retry bun test",
        unansweredAsk: "answer Platform",
        openPlanItem: "ship Quiet",
      })
    ).toBe("fix CI");
    expect(
      pickQuietRecapNext({
        pendingTodo: null,
        lastFailure: "retry bun test",
        unansweredAsk: "answer Platform",
        openPlanItem: "ship Quiet",
      })
    ).toBe("retry bun test");
    expect(
      pickQuietRecapNext({
        pendingTodo: null,
        lastFailure: null,
        unansweredAsk: "answer Platform",
        openPlanItem: "ship Quiet",
      })
    ).toBe("answer Platform");
    expect(
      pickQuietRecapNext({
        pendingTodo: null,
        lastFailure: null,
        unansweredAsk: null,
        openPlanItem: "ship Quiet",
      })
    ).toBe("ship Quiet");
    expect(pickQuietRecapNext({})).toBeNull();
    expect(
      pickQuietRecapNext({
        pendingTodo: "looking at files",
        lastFailure: null,
        openPlanItem: null,
      })
    ).toBeNull();
  });

  test("lastFailure / unansweredAsk / plan extractors are event-sourced", () => {
    expect(
      lastFailureNextLabel([
        { name: "file_edit", arg: "a.ts", outcome: "success" },
        { name: "bash", arg: "bun test", outcome: "failed" },
      ])
    ).toBe("retry bun test");
    expect(
      unansweredAskNextLabel([
        { name: "question", arg: "Platform", outcome: "failed" },
      ])
    ).toBe("answer Platform");
    expect(extractOpenPlanItem("- [x] done\n- [ ] token-refresh test\n")).toBe(
      "token-refresh test"
    );
    expect(extractOpenPlanItem("- [x] all done\n")).toBeNull();
  });

  test("Recap includes blocked tools without inventing Next", () => {
    const line = formatQuietRecap(
      [
        {
          name: "bash",
          arg: "rm -rf /",
          outcome: "blocked",
          fact: "ran rm -rf / blocked",
        },
      ],
      {
        lastFailure: null,
        pendingTodo: null,
        unansweredAsk: null,
        openPlanItem: null,
      }
    );
    expect(line).toBe("Recap: ran rm -rf / blocked");
    expect(line).not.toContain("Next:");
  });

  test("Recap auto-Next from failure when open work remains", () => {
    const line = formatQuietRecap([
      {
        name: "bash",
        arg: "bun test",
        outcome: "failed",
        fact: "ran bun test failed",
      },
    ]);
    expect(line).toBe("Recap: ran bun test failed · Next: retry bun test");
  });

  test("Recap Next absent when hints explicitly cleared (turn complete)", () => {
    const line = formatQuietRecap(
      [
        {
          name: "bash",
          arg: "bun test",
          outcome: "failed",
          fact: "ran bun test failed",
        },
      ],
      {
        pendingTodo: null,
        lastFailure: null,
        unansweredAsk: null,
        openPlanItem: null,
      }
    );
    expect(line).toBe("Recap: ran bun test failed");
    expect(line).not.toContain("Next:");
  });

  test("Recap null when no events or only mush", () => {
    expect(formatQuietRecap([])).toBeNull();
    expect(
      formatQuietRecap([
        { name: "todo_write", arg: "", outcome: "success" },
        { name: "ls", arg: ".", outcome: "success" }, // no fact, vague
      ])
    ).toBeNull();
  });

  test("Recap wrap is at most 3 lines with ellipsis", () => {
    const long = formatQuietRecap([
      {
        name: "file_read",
        arg: "a-very-long-filename-aaaaaaaa.md",
        outcome: "success",
        fact: "read a-very-long-filename-aaaaaaaa.md (80 lines)",
      },
      {
        name: "file_edit",
        arg: "b-very-long-filename-bbbbbbbb.ts",
        outcome: "success",
        fact: "edited b-very-long-filename-bbbbbbbb.ts",
      },
      {
        name: "grep",
        arg: "c-very-long-pattern-cccccccccc",
        outcome: "success",
        fact: "searched c-very-long-pattern-cccccccccc (12 matches)",
      },
      {
        name: "bash",
        arg: "d-very-long-command-dddddddddd",
        outcome: "success",
        fact: "ran d-very-long-command-dddddddddd",
      },
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

  test("shortQuietArg ls root stays '.' (not cwd basename mush)", () => {
    expect(shortQuietArg("ls", {})).toBe(".");
    expect(shortQuietArg("ls", { path: "." })).toBe(".");
    expect(shortQuietArg("ls", { path: "src/cli" })).toBe("cli");
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
    expect(first!.workedForLine).toBe("Worked for 340ms using 1 tool");
    expect(first!.toolCount).toBe(1);
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
