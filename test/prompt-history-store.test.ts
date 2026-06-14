import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  loadPromptHistory,
  savePromptHistory,
} from "../src/util/prompt-history-store.js";
import { getCurrentProjectID } from "../src/session/store.js";

let tmpDir: string;

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  }
});

describe("prompt history store", () => {
  test("round-trips entries per project", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-history-"));
    const projectID = getCurrentProjectID();
    const entries = ["/model", "! git status", "hello"];
    await savePromptHistory(entries, { projectID, baseDir: tmpDir });
    const loaded = await loadPromptHistory({ projectID, baseDir: tmpDir });
    expect(loaded).toEqual(entries);
  });

  test("missing file returns empty array", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-history-"));
    const loaded = await loadPromptHistory({
      projectID: "missing-project",
      baseDir: tmpDir,
    });
    expect(loaded).toEqual([]);
  });

  test("corrupt file returns empty array", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-history-"));
    const projectID = getCurrentProjectID();
    fs.writeFileSync(path.join(tmpDir, `${projectID}.json`), "not-json", "utf-8");
    const loaded = await loadPromptHistory({ projectID, baseDir: tmpDir });
    expect(loaded).toEqual([]);
  });

  test("serialized overlapping saves keep all entries", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-history-"));
    const projectID = getCurrentProjectID();
    const baseDir = tmpDir;

    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const originalWriteFile = fs.promises.writeFile;
    let writeCount = 0;
    fs.promises.writeFile = async (...args) => {
      writeCount++;
      if (writeCount === 1) await gate;
      return originalWriteFile(...args);
    };

    try {
      const saveChain = Promise.resolve()
        .then(() => savePromptHistory(["first"], { projectID, baseDir }))
        .then(() => savePromptHistory(["first", "second"], { projectID, baseDir }));

      releaseFirst();
      await saveChain;

      const loaded = await loadPromptHistory({ projectID, baseDir });
      expect(loaded).toEqual(["first", "second"]);
    } finally {
      fs.promises.writeFile = originalWriteFile;
    }
  });
});
