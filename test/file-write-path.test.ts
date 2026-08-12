import { afterEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Tool } from "../src/tools/registry.js";
import { setAllowAllBypass } from "../src/permission/index.js";
import { setCurrentMode } from "../src/tools/mode-state.js";
import { enterAgentModeForTest } from "./helpers/authority.js";
import "../src/tools/init.js";

describe("file_write path handling", () => {
  const createdDirs: string[] = [];

  afterEach(async () => {
    setAllowAllBypass(false);
    setCurrentMode("ASK");
    await Promise.all(
      createdDirs.splice(0).map((dir) =>
        fs.rm(dir, { recursive: true, force: true })
      )
    );
  });

  test("writes absolute paths outside cwd when allow-all grants outside-cwd access", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "impulse-file-write-"));
    createdDirs.push(dir);
    const filePath = path.join(dir, "nested", "config.json");

    await enterAgentModeForTest();
    setAllowAllBypass(true);
    const result = await Tool.execute("file_write", {
      filePath,
      content: "{\"ok\":true}\n",
    });

    expect(result.success).toBe(true);
    await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("{\"ok\":true}\n");
  });
});
