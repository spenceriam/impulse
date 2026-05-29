import { describe, expect, test } from "bun:test";
import { MAX_CONCURRENT_SUBAGENTS } from "../src/agent/task-pool.js";
import { needsGeneralBatchPermission } from "../src/permission/task-batch.js";

describe("needsGeneralBatchPermission", () => {
  test("does not require permission at or below concurrent cap", () => {
    expect(needsGeneralBatchPermission(0)).toBe(false);
    expect(needsGeneralBatchPermission(1)).toBe(false);
    expect(needsGeneralBatchPermission(MAX_CONCURRENT_SUBAGENTS)).toBe(false);
  });

  test("requires permission above concurrent cap", () => {
    expect(needsGeneralBatchPermission(MAX_CONCURRENT_SUBAGENTS + 1)).toBe(true);
    expect(needsGeneralBatchPermission(25)).toBe(true);
  });
});
