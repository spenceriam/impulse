import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import "../src/tools/init";
import { Tool } from "../src/tools/registry";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("grep tool", () => {
  test("uses packaged ripgrep and parses absolute paths", async () => {
    const dir = mkdtempSync(join(process.cwd(), "impulse-grep-"));
    tempDirs.push(dir);
    writeFileSync(join(dir, "sample.txt"), "hello world\nsecond line\n", "utf-8");

    const result = await Tool.execute("grep", {
      pattern: "hello",
      path: dir,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain("sample.txt");
    expect(result.output).toContain("hello world");
    expect((result.metadata as { matchCount?: number } | undefined)?.matchCount).toBe(1);
  });
});
