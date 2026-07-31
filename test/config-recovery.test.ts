import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { createDefaultConfig, saveConfigFileAtomic } from "../src/util/config.js";

describe("config recovery writes", () => {
  let dir: string;
  let target: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "impulse-config-recovery-"));
    target = path.join(dir, "config.json");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("backs up the last valid config before atomic replacement", async () => {
    const previous = JSON.stringify(createDefaultConfig({ hasSeenWelcome: false }), null, 2);
    await fs.writeFile(target, previous, "utf-8");

    await saveConfigFileAtomic(createDefaultConfig({ hasSeenWelcome: true }), target);

    expect(await fs.readFile(`${target}.bak`, "utf-8")).toBe(previous);
    expect(JSON.parse(await fs.readFile(target, "utf-8")).hasSeenWelcome).toBe(true);
  });

  test("preserves malformed config and reports the file and backup paths", async () => {
    const malformed = '{"userProfile": {"name": "broken"';
    await fs.writeFile(target, malformed, "utf-8");

    await expect(
      saveConfigFileAtomic(createDefaultConfig({ hasSeenWelcome: true }), target)
    ).rejects.toThrow(target);
    await expect(
      saveConfigFileAtomic(createDefaultConfig({ hasSeenWelcome: true }), target)
    ).rejects.toThrow(`${target}.bak`);
    expect(await fs.readFile(target, "utf-8")).toBe(malformed);
  });
});
