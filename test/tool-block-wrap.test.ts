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

  test("multiline bash command collapses newlines in summary", () => {
    const command = "gh issue create \\\n--repo spenceriam/impulse \\\n--title bug";
    const block = new ToolBlock("bash", { command });
    const lines = block.render(80);
    expect(lines.join("\n")).not.toContain("\r");
    expect(lines.join("\n")).toContain("gh issue create");
    expect(lines.join("\n")).toContain("--repo");
  });

  test("failed compact bash wraps instead of horizontal ellipsis", () => {
    const command = "npm run test -- " + "segment-".repeat(20);
    const block = new ToolBlock("bash", { command });
    block.setDone({ success: false, output: "fail" }, 40, { compact: true });
    const lines = block.render(40);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line).not.toContain("…");
    }
  });
});
