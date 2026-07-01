import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { bashTool } from "../src/tools/bash.js";
import { resetAllowAllBypass, setAllowAllBypass } from "../src/permission/index.js";

describe("bash output pagination", () => {
  let root: string;

  beforeAll(() => {
    setAllowAllBypass(true);
    root = mkdtempSync(path.join(tmpdir(), "impulse-bash-pagination-"));
  });

  afterAll(() => {
    resetAllowAllBypass();
    rmSync(root, { recursive: true, force: true });
  });

  test("offset/limit within the byte cap reports the accurate next offset", async () => {
    const file = path.join(root, "lines-6000.txt");
    writeFileSync(file, Array.from({ length: 6000 }, (_, i) => `line${i}`).join("\n"));

    const result = await bashTool.handler({
      command: "cat lines-6000.txt",
      description: "test pagination",
      workdir: root,
      limit: 5000,
      timeout: 10_000,
    });

    expect(result.success).toBe(true);
    // The 2000-line hard cap governs even though the caller asked for 5000,
    // so the note must flag that the requested slice was further capped.
    expect(result.output).toContain("[Output paginated: lines 1-2000 of 6000, further capped by output size limits");
    expect(result.output).toContain("Re-run with offset: 2000 for more.]");
  });

  test("a byte-cap hit is reflected in the pagination note and next offset", async () => {
    const file = path.join(root, "lines-wide.txt");
    writeFileSync(file, Array.from({ length: 300 }, (_, i) => `L${i}-${"x".repeat(1000)}`).join("\n"));

    const result = await bashTool.handler({
      command: "cat lines-wide.txt",
      description: "test pagination byte cap",
      workdir: root,
      limit: 250,
      timeout: 10_000,
    });

    expect(result.success).toBe(true);
    const match = result.output.match(/\[Output paginated: lines 1-(\d+) of 300, further capped by output size limits\. Re-run with offset: (\d+) for more\.\]/);
    expect(match).not.toBeNull();
    const delivered = Number(match?.[1]);
    const nextOffset = Number(match?.[2]);
    expect(delivered).toBeLessThan(250);
    expect(nextOffset).toBe(delivered);
  });

  test("no offset/limit means legacy (non-paginated) behavior", async () => {
    const file = path.join(root, "small.txt");
    writeFileSync(file, "a\nb\nc");

    const result = await bashTool.handler({
      command: "cat small.txt",
      description: "test no pagination",
      workdir: root,
      timeout: 10_000,
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe("a\nb\nc");
    expect(result.output).not.toContain("[Output paginated:");
  });
});
