import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { lsTool } from "../src/tools/ls.js";

describe("ls", () => {
  // sanitizePath() restricts reads to within process.cwd() by default, so
  // fixtures must live under the repo root rather than the OS tmpdir.
  const root = path.join(process.cwd(), `.tmp-ls-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(root, { recursive: true });
    mkdirSync(path.join(root, "subdir"));
    writeFileSync(path.join(root, "hello-world.ts"), "content");
    writeFileSync(path.join(root, "another.ts"), "content");
    writeFileSync(path.join(root, ".hidden"), "content");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("lists files and directories, sorted case-insensitively with a trailing slash on dirs", async () => {
    const result = await lsTool.handler({ path: root });

    expect(result.success).toBe(true);
    expect(result.output).toContain(`${root} (4 entries)`);
    expect(result.output).toContain("subdir/");
    expect(result.output).toContain("hello-world.ts");
    expect(result.output).toContain(".hidden");
    expect(result.metadata?.["type"]).toBe("ls");
    expect(result.metadata?.["totalEntries"]).toBe(4);

    const lines = result.output.split("\n").slice(1);
    const sorted = [...lines].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    expect(lines).toEqual(sorted);
  });

  test("defaults to the current working directory and notes it", async () => {
    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      const result = await lsTool.handler({});
      expect(result.success).toBe(true);
      expect(result.output).toContain("Note:");
      expect(result.output).toContain("current working directory");
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("a file path returns a corrective error mentioning file_read", async () => {
    const result = await lsTool.handler({ path: path.join(root, "hello-world.ts") });

    expect(result.success).toBe(false);
    expect(result.output).toContain("is a file, not a directory");
    expect(result.output).toContain("file_read");
  });

  test("a missing path returns Directory not found", async () => {
    const result = await lsTool.handler({ path: path.join(root, "does-not-exist") });

    expect(result.success).toBe(false);
    expect(result.output).toContain("Directory not found");
  });

  test("limit truncates results and reports the total", async () => {
    const result = await lsTool.handler({ path: root, limit: 2 });

    expect(result.success).toBe(true);
    expect(result.output).toContain("(showing first 2 of 4 entries)");
    expect(result.metadata?.["entryCount"]).toBe(2);
    expect(result.metadata?.["totalEntries"]).toBe(4);
    expect(result.metadata?.["truncated"]).toBe(true);
  });
});
