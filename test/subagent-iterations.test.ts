import { describe, expect, test } from "bun:test";
import {
  subagentMaxIterations,
  SUBAGENT_MAX_ITERATIONS,
} from "../src/agent/task-runner.js";

describe("subagent iteration cap", () => {
  test("legacy export remains for compatibility", () => {
    expect(SUBAGENT_MAX_ITERATIONS).toBe(150);
  });

  test("explore cap is 40", () => {
    expect(subagentMaxIterations("explore")).toBe(40);
  });

  test("general cap is 80", () => {
    expect(subagentMaxIterations("general")).toBe(80);
  });
});
