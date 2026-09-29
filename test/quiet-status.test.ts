import { describe, expect, test } from "bun:test";
import {
  classifyQuietOutcome,
  formatQuietLiveStatus,
  formatQuietRecap,
  formatWorkedFor,
  isQuietBreakOutcome,
  quietThinkingPhrase,
  shortQuietArg,
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

  test("Worked for uses wall-clock seconds (min 1)", () => {
    expect(formatWorkedFor(0)).toBe("Worked for 1s");
    expect(formatWorkedFor(450)).toBe("Worked for 1s");
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

  test("Recap is event-sourced one short line", () => {
    const line = formatQuietRecap([
      { name: "file_read", arg: "AGENTS.md", outcome: "success" },
      { name: "file_edit", arg: "renderer.ts", outcome: "success" },
      { name: "bash", arg: "bun test", outcome: "success" },
    ]);
    expect(line).toBe("Recap: reading AGENTS.md, editing renderer.ts, running bun test");
  });

  test("Recap includes blocked tools", () => {
    const line = formatQuietRecap([
      { name: "bash", arg: "rm -rf /", outcome: "blocked" },
    ]);
    expect(line).toBe("Recap: running blocked");
  });

  test("Recap null when no events", () => {
    expect(formatQuietRecap([])).toBeNull();
  });
});
