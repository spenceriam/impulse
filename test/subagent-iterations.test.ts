import { describe, expect, test } from "bun:test";
import { SUBAGENT_MAX_ITERATIONS } from "../src/agent/task-runner.js";

describe("subagent iteration cap", () => {
  test("SUBAGENT_MAX_ITERATIONS is 150", () => {
    expect(SUBAGENT_MAX_ITERATIONS).toBe(150);
  });
});