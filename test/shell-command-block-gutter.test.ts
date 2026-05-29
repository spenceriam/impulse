import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import { maxLineWidth } from "../src/cli/gutter.js";
import { ShellCommandBlock } from "../src/cli/components/shell-command-block.js";

describe("ShellCommandBlock gutter", () => {
  test("wide script output does not spill into right gutter", () => {
    const width = 100;
    const block = new ShellCommandBlock("python3 validate.py");
    block.appendOutput("=".repeat(120) + "\nPLANET DATA VALIDATION\n" + "x".repeat(120));
    block.setDone(1, 30);

    const lines = block.render(width);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(maxLineWidth(width));
    }
  });
});
