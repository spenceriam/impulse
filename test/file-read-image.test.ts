import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { fileRead } from "../src/tools/file-read.js";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

// 1x1 transparent PNG — same fixture the vision probe uses.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

// sanitizePath restricts reads to cwd — build fixtures inside the workspace.
const dir = join(process.cwd(), ".impulse", "test-img-fixtures");
const pngPath = join(dir, "shot.png");
const elfPath = join(dir, "prog.elf");
const txtPath = join(dir, "hello.txt");

beforeAll(() => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(pngPath, TINY_PNG);
  writeFileSync(elfPath, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]));
  writeFileSync(txtPath, "hello world");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("file_read image handling (#134)", () => {
  test("PNG file returns success with imageUris data URI", async () => {
    const result = await fileRead.handler({ filePath: pngPath });
    expect(result.success).toBe(true);
    expect(result.imageUris?.length).toBe(1);
    expect(result.imageUris?.[0]?.startsWith("data:image/png;base64,")).toBe(true);
    expect(result.output).toContain("shot.png");
  });

  test("non-image binary keeps the clear refusal", async () => {
    const result = await fileRead.handler({ filePath: elfPath });
    expect(result.success).toBe(false);
    expect(result.output).toContain("Cannot read binary file");
    expect(result.imageUris).toBeUndefined();
  });

  test("text files are unaffected", async () => {
    const result = await fileRead.handler({ filePath: txtPath });
    expect(result.success).toBe(true);
    expect(result.output).toContain("hello world");
    expect(result.imageUris).toBeUndefined();
  });
});