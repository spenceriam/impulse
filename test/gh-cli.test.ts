import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { resolveGhCliPath } from "../src/git/gh-cli.js";

describe("resolveGhCliPath", () => {
  test("uses GH_CLI_PATH override when it exists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-gh-"));
    try {
      const fakeGh = path.join(dir, process.platform === "win32" ? "gh.exe" : "gh");
      fs.writeFileSync(fakeGh, "");
      expect(resolveGhCliPath({ GH_CLI_PATH: fakeGh, PATH: "" })).toBe(fakeGh);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns null for missing GH_CLI_PATH override", () => {
    expect(resolveGhCliPath({ GH_CLI_PATH: path.join(os.tmpdir(), "missing-gh"), PATH: "" })).toBeNull();
  });

  test("finds gh on PATH without invoking the shell", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-gh-path-"));
    try {
      const name = process.platform === "win32" ? "gh.exe" : "gh";
      const fakeGh = path.join(dir, name);
      fs.writeFileSync(fakeGh, "");
      expect(resolveGhCliPath({ PATH: dir, PATHEXT: ".EXE;.CMD" })).toBe(fakeGh);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
