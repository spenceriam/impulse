import { describe, expect, test } from "bun:test";
import { QuietRecapBlock } from "../src/cli/components/recap-block.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

const LONG =
  "Recap: Installed SolidCraft locally on Omarchy instead of as a web app; v0.16.2 " +
  "is unpacked to ~/.local/opt with both binaries on PATH, a menu launcher, and a " +
  "verified checksum, and the GUI is open now. Next: close the sample window and " +
  "try a solidcraft-cli command.";

describe("QuietRecapBlock reflows with terminal width (#175)", () => {
  test("wide terminal uses fewer lines than narrow", () => {
    const block = new QuietRecapBlock(LONG);
    const wide = block.render(140);
    const narrow = block.render(60);
    expect(wide.length).toBeLessThan(narrow.length);
    // Every rendered row fits the requested width (gutters included).
    for (const line of [...wide, ...narrow]) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(140);
    }
  });

  test("same content at both widths, ghost-styled", () => {
    const block = new QuietRecapBlock(LONG);
    const wideText = stripAnsi(block.render(140).join(" ")).replace(/\s+/g, " ");
    const narrowText = stripAnsi(block.render(60).join(" ")).replace(/\s+/g, " ");
    expect(wideText).toContain("Installed SolidCraft locally");
    expect(wideText).toContain("try a solidcraft-cli command.");
    expect(narrowText).toContain("Installed SolidCraft locally");
    expect(narrowText).toContain("try a solidcraft-cli command.");
    // Ghost line: dim + italic applied per render
    expect(block.render(80)[0]).toContain("\x1b[2m");
    expect(block.render(80)[0]).toContain("\x1b[3m");
  });

  test("hard newlines in a model recap collapse to one paragraph", () => {
    const block = new QuietRecapBlock("Recap: first part\nsecond part");
    const joined = stripAnsi(block.render(200).join("")).replace(/\s+/g, " ");
    expect(joined).toContain("first part second part");
  });
});
