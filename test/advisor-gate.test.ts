import { describe, expect, test } from "bun:test";
import {
  isReadOnlyBashCommand,
  shouldBlockBeforeAdvisor,
} from "../src/agent/advisor-gate";

describe("isReadOnlyBashCommand", () => {
  test("allows common read-only commands", () => {
    expect(isReadOnlyBashCommand("ls -la")).toBe(true);
    expect(isReadOnlyBashCommand("git status")).toBe(true);
    expect(isReadOnlyBashCommand("grep -r foo src")).toBe(true);
  });

  test("rejects mutating commands", () => {
    expect(isReadOnlyBashCommand("rm -rf x")).toBe(false);
    expect(isReadOnlyBashCommand("npm install")).toBe(false);
    expect(isReadOnlyBashCommand("touch foo")).toBe(false);
    expect(isReadOnlyBashCommand("git commit -m x")).toBe(false);
  });

  test("rejects empty command", () => {
    expect(isReadOnlyBashCommand("")).toBe(false);
    expect(isReadOnlyBashCommand("   ")).toBe(false);
  });
});

describe("shouldBlockBeforeAdvisor", () => {
  test("blocks mutating tools", () => {
    expect(shouldBlockBeforeAdvisor("file_write", { path: "a.ts" })).toBe(true);
    expect(shouldBlockBeforeAdvisor("task", { prompt: "x" })).toBe(true);
  });

  test("allows read-only bash", () => {
    expect(shouldBlockBeforeAdvisor("bash", { command: "ls -la" })).toBe(false);
  });

  test("blocks non-readonly and missing bash commands", () => {
    expect(shouldBlockBeforeAdvisor("bash", { command: "rm -rf x" })).toBe(true);
    expect(shouldBlockBeforeAdvisor("bash", { command: "npm install" })).toBe(true);
    expect(shouldBlockBeforeAdvisor("bash", {})).toBe(true);
    expect(shouldBlockBeforeAdvisor("bash", { command: "" })).toBe(true);
  });

  test("allows unrelated tools", () => {
    expect(shouldBlockBeforeAdvisor("file_read", { path: "a.ts" })).toBe(false);
    expect(shouldBlockBeforeAdvisor("grep", { pattern: "x" })).toBe(false);
  });
});
