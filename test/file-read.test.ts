import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { fileRead } from "../src/tools/file-read.js";

describe("file_read", () => {
  // sanitizePath() restricts reads to within process.cwd() by default, so
  // fixtures must live under the repo root rather than the OS tmpdir.
  const root = path.join(process.cwd(), `.tmp-file-read-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(root, { recursive: true });
    mkdirSync(path.join(root, "subdir"));
    writeFileSync(path.join(root, "hello-world.ts"), "content");
    writeFileSync(path.join(root, "another.ts"), "content");

    // Binary / encoding fixtures
    writeFileSync(path.join(root, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    writeFileSync(path.join(root, "utf16.txt"), Buffer.from([0xff, 0xfe, 0x61, 0x00, 0x62, 0x00]));
    writeFileSync(path.join(root, "bom.txt"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hello", "utf-8")]));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("ENOENT includes a Did you mean suggestion for a close filename", async () => {
    const result = await fileRead.handler({ filePath: path.join(root, "hello_world.ts") });

    expect(result.success).toBe(false);
    expect(result.output).toContain("File not found:");
    expect(result.output).toContain("Did you mean: hello-world.ts?");
  });

  test("ENOENT includes a compact directory listing", async () => {
    const result = await fileRead.handler({ filePath: path.join(root, "does-not-exist.ts") });

    expect(result.success).toBe(false);
    expect(result.output).toContain(`Directory ${root}`);
    expect(result.output).toContain("subdir/");
    expect(result.output).toContain("hello-world.ts");
  });

  test("ENOENT on a missing directory returns no hint (readdir fails too)", async () => {
    const result = await fileRead.handler({ filePath: path.join(root, "ghost-dir", "missing.ts") });

    expect(result.success).toBe(false);
    expect(result.output).toBe(`File not found: ${path.join(root, "ghost-dir", "missing.ts")}`);
  });

  test("binary file (PNG) is rejected with a clear message", async () => {
    const result = await fileRead.handler({ filePath: path.join(root, "image.png") });

    expect(result.success).toBe(false);
    expect(result.output).toContain("Cannot read binary file");
    expect(result.output).toContain("PNG image");
  });

  test("UTF-16 file is rejected with an encoding notice", async () => {
    const result = await fileRead.handler({ filePath: path.join(root, "utf16.txt") });

    expect(result.success).toBe(false);
    expect(result.output).toContain("UTF-16 LE");
  });

  test("UTF-8 BOM is silently stripped", async () => {
    const result = await fileRead.handler({ filePath: path.join(root, "bom.txt") });

    expect(result.success).toBe(true);
    expect(result.output).toContain("hello");
    expect(result.output).not.toContain("﻿");
  });
});
