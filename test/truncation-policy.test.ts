import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { visibleWidth } from "@mariozechner/pi-tui";
import { ToolBlock } from "../src/cli/components/tool-block.js";
import { ShellCommandBlock } from "../src/cli/components/shell-command-block.js";
import { maxLineWidth } from "../src/cli/gutter.js";

describe("truncation policy", () => {
  test("summarizeArgs source does not pre-slice argument text", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/cli/components/tool-block.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/slice\(0,\s*70\)/);
  });

  test("long bash tool args wrap without horizontal ellipsis", () => {
    const command = "npm run test -- " + "very-long-segment-".repeat(12);
    const block = new ToolBlock("bash", { command });
    block.setDone({ success: true, output: "ok" }, 50, { compact: true });

    const width = 72;
    const lines = block.render(width);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(maxLineWidth(width));
      expect(line).not.toContain("…");
    }
    expect(lines.join("\n")).toContain("very-long-segment");
  });

  test("long shell command header wraps without horizontal ellipsis", () => {
    const command = "python3 " + "validate_planet_data_".repeat(8) + ".py";
    const block = new ShellCommandBlock(command);
    block.setDone(0, 120);

    const width = 80;
    const lines = block.render(width);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(maxLineWidth(width));
      expect(line).not.toContain("…");
    }
    expect(lines.join("\n")).toContain("validate_planet_data");
  });
});
