import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { sanitizePath, SecurityError } from "../src/util/path";
import { tmpdir } from "os";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "fs";
import path from "path";

describe("sanitizePath", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(path.join(tmpdir(), "sanitize-path-test-"));
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
    mkdirSync(path.join(testDir, "subdir"), { recursive: true });
    const result = sanitizePath("subdir/file.txt", testDir);
    expect(result).toMatch(testDir);
    expect(result).toContain("subdir");
  });

  it("should reject symlink pointing outside base directory", () => {
    const outsideDir = mkdtempSync(path.join(tmpdir(), "outside-"));
    const symlinkPath = path.join(testDir, "link-to-outside");

    try {
      writeFileSync(path.join(outsideDir, "secret.txt"), "secret data");
      try {
        symlinkSync(outsideDir, symlinkPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") return;
        throw error;
      }

      expect(() => {
        sanitizePath("link-to-outside/secret.txt", testDir);
      }).toThrow(SecurityError);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("should allow symlink pointing within base directory", () => {
    const subdir = path.join(testDir, "subdir2");
    const symlinkPath = path.join(testDir, "link2");
    const filePath = path.join(subdir, "file.txt");

    mkdirSync(subdir, { recursive: true });
    writeFileSync(filePath, "data");
    try {
      symlinkSync(subdir, symlinkPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }

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
    mkdirSync(path.join(testDir, "a", "b", "c", "d"), { recursive: true });
    expect(() => {
      sanitizePath("a/b/c/d/../../../../../etc/passwd", testDir);
    }).toThrow(SecurityError);
  });
});
