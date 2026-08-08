import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  appendUserInstructions,
  clearUserInstructions,
  importUserInstructions,
  loadEffectiveUserInstructions,
  normalizeUserInstructions,
  readStoredUserInstructions,
  replaceUserInstructions,
  resolveUserInstructionsImportPath,
  resolveWorkspaceUserInstructionsImportPath,
} from "../src/util/user-instructions.js";

describe("user instructions storage", () => {
  let dir: string;
  let target: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "impulse-user-instructions-"));
    target = path.join(dir, "user-instructions.md");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("normalizes line endings while preserving Markdown structure", async () => {
    const markdown = "# Header\r\n\r\n- first\r- second\r\n\r\n```ts\r\nconst x = 1;\r\n```";
    const stored = await replaceUserInstructions(markdown, target);

    expect(stored.content).toBe(
      "# Header\n\n- first\n- second\n\n```ts\nconst x = 1;\n```"
    );
    expect(await fs.readFile(target, "utf-8")).toBe(stored.content);
  });

  test("appends a separate Markdown block", async () => {
    await replaceUserInstructions("# First\n\nBody", target);
    const stored = await appendUserInstructions("## Second\n\nMore", target);

    expect(stored.content).toBe("# First\n\nBody\n\n## Second\n\nMore");
  });

  test("an existing empty file intentionally overrides legacy inline instructions", async () => {
    await clearUserInstructions(target);
    const effective = await loadEffectiveUserInstructions("Legacy instruction", target);

    expect(effective.source).toBe("file");
    expect(effective.content).toBe("");
  });

  test("falls back to legacy inline instructions when the Markdown file is missing", async () => {
    const effective = await loadEffectiveUserInstructions("Legacy\r\ncontent", target);

    expect(effective.source).toBe("legacy_config");
    expect(effective.sourceLabel).toBe("~/.impulse/config.json");
    expect(effective.content).toBe("Legacy\ncontent");
  });

  test("imports an explicit @path relative to the working directory", async () => {
    const source = path.join(dir, "source.md");
    await fs.writeFile(source, "# Imported\r\n\r\nComplete", "utf-8");

    const stored = await importUserInstructions("@source.md", {
      cwd: dir,
      targetPath: target,
    });

    expect(stored.content).toBe("# Imported\n\nComplete");
    expect(resolveUserInstructionsImportPath("@source.md", dir)).toBe(source);
  });

  test("reports a missing canonical file without creating it", async () => {
    await expect(readStoredUserInstructions(target)).resolves.toMatchObject({
      exists: false,
      content: "",
      path: target,
    });
  });

  test("agent imports reject paths outside the real workspace", async () => {
    const workspace = path.join(dir, "workspace");
    const outside = path.join(dir, "outside.md");
    await fs.mkdir(workspace);
    await fs.writeFile(outside, "outside", "utf-8");

    await expect(
      resolveWorkspaceUserInstructionsImportPath("@../outside.md", workspace)
    ).rejects.toThrow("limited to the current workspace");
  });

  test("re-reads external edits even when the file size is unchanged", async () => {
    await replaceUserInstructions("first", target);
    const first = await loadEffectiveUserInstructions(undefined, target);
    await fs.writeFile(target, "later", "utf-8");
    const later = await loadEffectiveUserInstructions(undefined, target);

    expect(later.content).toBe("later");
    expect(later.fingerprint).not.toBe(first.fingerprint);
  });
});
