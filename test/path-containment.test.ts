import { describe, expect, test } from "bun:test";
import path from "path";
import { isWithinBase } from "../src/util/path.js";

describe("isWithinBase", () => {
  test("handles POSIX containment", () => {
    const p = path.posix;
    expect(isWithinBase("/repo", "/repo/src/index.ts", p)).toBe(true);
    expect(isWithinBase("/repo", "/repo", p)).toBe(true);
    expect(isWithinBase("/repo", "/outside", p)).toBe(false);
    expect(isWithinBase("/repo", "/repo/../../outside", p)).toBe(false);
    expect(isWithinBase("/repo", "/repo2", p)).toBe(false);
    expect(isWithinBase("/repo", "/repo/..foo", p)).toBe(true);
  });

  test("handles Windows containment", () => {
    const p = path.win32;
    expect(isWithinBase("C:\\repo", "C:\\repo\\src\\index.ts", p)).toBe(true);
    expect(isWithinBase("C:\\repo", "C:\\outside", p)).toBe(false);
    expect(isWithinBase("C:\\repo", "C:\\repo\\..\\..\\outside", p)).toBe(false);
    expect(isWithinBase("C:\\repo", "C:\\repo2", p)).toBe(false);
    expect(isWithinBase("C:\\repo", "D:\\outside", p)).toBe(false);
    expect(isWithinBase("C:\\repo", "C:\\repo\\..foo", p)).toBe(true);
  });
});
