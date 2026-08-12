import { describe, expect, spyOn, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  stageJsonAtomic,
  writeFileAtomic,
  writeJsonAtomic,
} from "../src/util/atomic-write.js";

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

  test("conditional promotion rejects stale work and removes its stage", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "impulse-atomic-guard-"));
    try {
      const file = path.join(dir, "state.json");
      await writeJsonAtomic(file, { generation: "replacement" });
      const stage = await stageJsonAtomic(file, { generation: "stale" });

      const promoted = await stage.commitIf(() => false);

      expect(promoted).toBe(false);
      await expect(fs.readFile(file, "utf-8").then(JSON.parse)).resolves.toEqual({
        generation: "replacement",
      });
      expect((await fs.readdir(dir)).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("directory fsync failure releases the write chain for a later promotion", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "impulse-atomic-fsync-"));
    const file = path.join(dir, "state.json");
    const open = fs.open.bind(fs);
    let injectFailure = true;
    const openSpy = spyOn(fs, "open").mockImplementation(async (...args) => {
      const [target, flags] = args;
      if (
        injectFailure &&
        flags === "r" &&
        path.resolve(String(target)) === path.resolve(dir)
      ) {
        injectFailure = false;
        throw Object.assign(new Error("injected directory fsync failure"), { code: "EIO" });
      }
      return open(...args);
    });

    try {
      await expect(writeFileAtomic(file, "first")).rejects.toThrow(
        "injected directory fsync failure"
      );
      await writeFileAtomic(file, "second");
      await expect(fs.readFile(file, "utf-8")).resolves.toBe("second");
      expect((await fs.readdir(dir)).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
    } finally {
      openSpy.mockRestore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
