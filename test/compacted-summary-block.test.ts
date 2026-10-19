import { describe, expect, test } from "bun:test";
import { CompactedSummaryBlock } from "../src/cli/components/compacted-summary-block.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

const SUMMARY =
  "Goal was installing the CLI locally. Downloaded and verified the tarball,\n" +
  "unpacked to ~/.local/opt, linked the binaries. Next step was logging in.\n" +
  "The install is complete.";

describe("CompactedSummaryBlock (#176)", () => {
  test("renders the full summary as ghost chrome at the current width", () => {
    const block = new CompactedSummaryBlock(`Compacted: ${SUMMARY}`);
    const lines = block.render(80);
    const joined = stripAnsi(lines.join("\n"));
    expect(joined).toContain("Compacted: Goal was installing the CLI locally");
    expect(joined).toContain("The install is complete.");
    // Ghost chrome: dim+italic styling on every line (separate or combined codes)
    for (const line of lines) {
      expect(line).toMatch(/\x1b\[(?:2;3|2|3)m/);
    }
  });

  test("preserves paragraph newlines (no flattening)", () => {
    const block = new CompactedSummaryBlock(SUMMARY);
    const lines = block.render(200);
    // 3 paragraph lines at a generous width — not one flattened blob
    expect(lines.length).toBe(3);
    expect(stripAnsi(lines[1]!)).toContain("unpacked to ~/.local/opt");
    expect(stripAnsi(lines[2]!)).toContain("The install is complete.");
  });
});
