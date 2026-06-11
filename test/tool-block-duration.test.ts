import { describe, expect, test } from "bun:test";
import { ToolBlock } from "../src/cli/components/tool-block.js";
import { formatDurationBracketed } from "../src/cli/format-helpers.js";

describe("ToolBlock duration tail", () => {
  test("formatDurationBracketed wraps seconds in brackets", () => {
    expect(formatDurationBracketed(4500)).toBe("[4.5s]");
  });

  test("duration appears on last wrapped summary line", () => {
    const command =
      "cd /Users/spencer/GitHub/impulse && ls -la && cat package.json 2>/dev/null | head";
    const block = new ToolBlock("bash", { command });
    block.setDone({ success: true, output: "ok" }, 4500);

    const lines = block.render(72);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).not.toContain("[4.5s]");
    expect(lines[lines.length - 1]).toContain("[4.5s]");
  });

  test("compact bash shows bracketed duration", () => {
    const block = new ToolBlock("bash", { command: "echo hi" });
    block.setDone({ success: true, output: "hi" }, 50, { compact: true });
    const lines = block.render(72);
    expect(lines.join("\n")).toContain("[50ms]");
  });
});
