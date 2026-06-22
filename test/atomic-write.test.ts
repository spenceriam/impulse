import { describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { writeFileAtomic, writeJsonAtomic } from "../src/util/atomic-write.js";

describe("atomic writes", () => {
  test("writes valid JSON", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "impulse-atomic-"));
    try {
      const file = path.join(dir, "state.json");
      await writeJsonAtomic(file, { ok: true });
      await expect(fs.readFile(file, "utf-8").then(JSON.parse)).resolves.toEqual({ ok: true });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("serializes concurrent writes to the same target", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "impulse-atomic-concurrent-"));
    try {
      const file = path.join(dir, "state.json");
      await Promise.all([
        writeJsonAtomic(file, { value: 1 }),
        writeJsonAtomic(file, { value: 2 }),
        writeJsonAtomic(file, { value: 3 }),
      ]);
      const parsed = JSON.parse(await fs.readFile(file, "utf-8")) as { value: number };
      expect([1, 2, 3]).toContain(parsed.value);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("cleans up temp files after failure", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "impulse-atomic-fail-"));
    try {
      const targetDir = path.join(dir, "state.json");
      await fs.mkdir(targetDir);
      await expect(writeFileAtomic(targetDir, "content")).rejects.toThrow();
      const entries = await fs.readdir(dir);
      expect(entries.filter((entry) => entry.includes(".tmp"))).toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
