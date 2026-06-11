import { describe, expect, test } from "bun:test";
import {
  buildOldStringNotFoundError,
  findExact,
  findLineTrimmed,
  resolveEditMatch,
} from "../src/tools/edit-match.js";

describe("edit-match", () => {
  test("findExact rejects empty oldString", () => {
    expect(findExact("hello", "")).toBeNull();
    expect(resolveEditMatch("hello", "")).toBeNull();
  });

  test("findExact matches literal substring", () => {
    const content = "  hello world\n  foo bar";
    const match = findExact(content, "hello world");
    expect(match).not.toBeNull();
    expect(match!.effectiveOldString).toBe("hello world");
    expect(match!.usedFallback).toBe(false);
  });

  test("findLineTrimmed rederives file indentation", () => {
    const content = "export function greet(name: string) {\n  return `Hello, ${name}!`;\n}";
    const oldString = "    return `Hello, ${name}!`;";
    const match = findLineTrimmed(content, oldString);
    expect(match).not.toBeNull();
    expect(match!.effectiveOldString).toBe("  return `Hello, ${name}!`;");
    expect(match!.usedFallback).toBe(true);
  });

  test("findLineTrimmed rejects ambiguous trimmed matches", () => {
    const content = "foo\nbar\nfoo\nbar";
    const oldString = "foo";
    expect(findLineTrimmed(content, oldString)).toBeNull();
  });

  test("resolveEditMatch uses trimmed fallback for unique multi-line window", () => {
    const content = "function a() {\n  return 1;\n}\n";
    const oldString = "function a() {\n    return 1;\n}";
    const resolved = resolveEditMatch(content, oldString);
    expect(resolved).not.toBeNull();
    expect(resolved!.usedFallback).toBe(true);
    expect(resolved!.effectiveOldString).toBe("function a() {\n  return 1;\n}");
  });

  test("buildOldStringNotFoundError hints at closest trimmed line", () => {
    const content = "line one\n  indented line\nline three";
    const oldString = "    indented line";
    const error = buildOldStringNotFoundError("src/foo.ts", content, oldString);
    expect(error).toContain("Closest match at line 2");
    expect(error).toContain("indentation/whitespace");
  });

  test("buildOldStringNotFoundError omits hint when no line matches", () => {
    const error = buildOldStringNotFoundError("src/foo.ts", "alpha\nbeta", "gamma");
    expect(error).toBe("oldString not found in file: src/foo.ts");
  });

  test("buildOldStringNotFoundError reports ambiguity instead of indentation hint", () => {
    const content = "foo\nbar\nfoo\nbar";
    const error = buildOldStringNotFoundError("src/foo.ts", content, "foo");
    expect(error).toContain("found 2 times");
    expect(error).toContain("whitespace normalization");
    expect(error).not.toContain("Closest match");
  });
});
