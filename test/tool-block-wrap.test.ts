import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import { ToolBlock } from "../src/cli/components/tool-block.js";
import { maxLineWidth } from "../src/cli/gutter.js";

describe("ToolBlock compact wrap", () => {
  test("compact bash wraps long commands instead of truncating", () => {
    const command =
      "cd /Users/spencer/GitHub/impulse && ls -la && cat package.json 2>/dev/null | head";
    const block = new ToolBlock("bash", { command });
    block.setDone({ success: true, output: "ok" }, 120, { compact: true });

    const lines = block.render(72);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(maxLineWidth(72));
      expect(line).not.toContain("…");
    }
    expect(lines.join("\n")).toContain("package.json");
  });
});
