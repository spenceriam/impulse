import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { sanitizePath, SecurityError } from "../src/util/path";
import { tmpdir } from "os";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "fs";

describe("sanitizePath", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(`${tmpdir()}/sanitize-path-test-`);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should allow simple relative path", () => {
    const result = sanitizePath("test.txt", testDir);
    expect(result).toMatch(testDir);
    expect(result).toContain("test.txt");
  });

  it("should reject path traversal with ..", () => {
    expect(() => {
      sanitizePath("../../../etc/passwd", testDir);
    }).toThrow(SecurityError);
  });

  it("should reject absolute path outside base directory", () => {
    expect(() => {
      sanitizePath("/etc/passwd", testDir);
    }).toThrow(SecurityError);
  });

  it("should allow relative path within base directory", () => {
    mkdirSync(`${testDir}/subdir`, { recursive: true });
    const result = sanitizePath("subdir/file.txt", testDir);
    expect(result).toMatch(testDir);
    expect(result).toContain("subdir");
  });

  it("should reject symlink pointing outside base directory", () => {
    const outsideDir = mkdtempSync(`${tmpdir()}/outside-`);
    const symlinkPath = `${testDir}/link-to-outside`;

    try {
      writeFileSync(`${outsideDir}/secret.txt`, "secret data");
      symlinkSync(outsideDir, symlinkPath);

      expect(() => {
        sanitizePath("link-to-outside/secret.txt", testDir);
      }).toThrow(SecurityError);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("should allow symlink pointing within base directory", () => {
    const subdir = `${testDir}/subdir2`;
    const symlinkPath = `${testDir}/link2`;
    const filePath = `${subdir}/file.txt`;

    mkdirSync(subdir, { recursive: true });
    writeFileSync(filePath, "data");
    symlinkSync(subdir, symlinkPath);

    const result = sanitizePath("link2/file.txt", testDir);
    expect(result).toMatch(testDir);
  });

  it("should handle empty path", () => {
    const result = sanitizePath("", testDir);
    expect(result).toMatch(testDir);
  });

  it("should handle path with multiple .. components", () => {
    expect(() => {
      sanitizePath("subdir/../../../etc/passwd", testDir);
    }).toThrow(SecurityError);
  });

  it("should reject deeply nested path traversal", () => {
    mkdirSync(`${testDir}/a/b/c/d`, { recursive: true });
    expect(() => {
      sanitizePath("a/b/c/d/../../../../../etc/passwd", testDir);
    }).toThrow(SecurityError);
  });
});
