import { describe, expect, test } from "bun:test";
import { ToolBlock, currentSpinnerFrame } from "../src/cli/components/tool-block.js";
import {
  SUBAGENT_PROGRESS_THINKING,
  SUBAGENT_PROGRESS_WRAPPING_UP,
} from "../src/cli/subagent-progress-labels.js";

describe("ToolBlock task timing and progress", () => {
  test("queued task shows no elapsed until running status", () => {
    const block = new ToolBlock("task", { description: "scan repo" });
    let lines = block.render(100);
    expect(lines[0]).toContain("queued");
    expect(lines[0]).not.toMatch(/\d+\.\d+s/);

    block.setSubagentTaskStatus("running");
    lines = block.render(100);
    expect(lines[0]).not.toContain("queued");
    expect(lines[0]).toMatch(/\d+\.\d+s|ms/);
  });

  test("renders interleaved thinking, tool, and wrapping up lines in order", () => {
    const block = new ToolBlock("task", { description: "multi-step" });
    block.setSubagentTaskStatus("running");
    block.appendSubagentLine({ type: "thinking", content: SUBAGENT_PROGRESS_THINKING });
    block.appendSubagentLine({ type: "tool", content: "grep pattern", durationMs: 120 });
    block.appendSubagentLine({ type: "status", content: SUBAGENT_PROGRESS_WRAPPING_UP });

    const rendered = block.render(120).join("\n");
    const thinkIdx = rendered.indexOf(SUBAGENT_PROGRESS_THINKING);
    const toolIdx = rendered.indexOf("grep pattern");
    const wrapIdx = rendered.indexOf(SUBAGENT_PROGRESS_WRAPPING_UP);
    expect(thinkIdx).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBeGreaterThan(thinkIdx);
    expect(wrapIdx).toBeGreaterThan(toolIdx);
  });

  test("getElapsedMs uses active start when running", () => {
    const block = new ToolBlock("task", { description: "work" });
    block.setSubagentTaskStatus("running");
    const state = (block as unknown as { state: { taskStartedAt?: number } }).state;
    if (state.taskStartedAt !== undefined) {
      state.taskStartedAt = Date.now() - 90_000;
    }
    expect(block.getElapsedMs()).toBeGreaterThanOrEqual(89_000);
  });

  test("aborted task preserves elapsed in collapsed row", () => {
    const block = new ToolBlock("task", { description: "long job" });
    block.setSubagentTaskStatus("running");
    const state = (block as unknown as { state: { taskStartedAt?: number } }).state;
    if (state.taskStartedAt !== undefined) {
      state.taskStartedAt = Date.now() - 125_000;
    }
    block.setDone(
      { success: false, output: "Sub-agent aborted by user" },
      block.getElapsedMs(),
      { collapsed: true }
    );
    const line = block.render(120)[0]!;
    expect(line).toContain("2m 5s");
    expect(line).not.toContain("0ms");
  });

  test("active task spinner phase follows epoch", () => {
    const t0 = Date.now() - 360;
    const a = currentSpinnerFrame("task", t0);
    const b = currentSpinnerFrame("task", t0 - 200);
    expect(a).not.toBe(b);
  });
});
