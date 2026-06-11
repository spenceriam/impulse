import { describe, expect, test } from "bun:test";
import {
  isSubstantiveToolBatch,
  shouldInjectPlanningLoopNudge,
  PLANNING_LOOP_NUDGE_MESSAGE,
} from "../src/agent/planning-nudge.js";

describe("planning loop nudge", () => {
  test("substantive tools include file_write and task", () => {
    expect(isSubstantiveToolBatch(["todo_write", "file_write"])).toBe(true);
    expect(isSubstantiveToolBatch(["bash", "todo_write"])).toBe(true);
    expect(isSubstantiveToolBatch(["todo_write", "set_header"])).toBe(false);
    expect(isSubstantiveToolBatch(["task"])).toBe(true);
  });

  test("fires after three planning-only iterations", () => {
    expect(
      shouldInjectPlanningLoopNudge({
        planningIterations: 3,
        nudgeUsed: false,
      })
    ).toBe(true);
    expect(
      shouldInjectPlanningLoopNudge({
        planningIterations: 2,
        nudgeUsed: false,
      })
    ).toBe(false);
  });

  test("does not fire on duplicate bash alone", () => {
    expect(
      shouldInjectPlanningLoopNudge({
        planningIterations: 0,
        nudgeUsed: false,
      })
    ).toBe(false);
  });

  test("fires at most once per turn", () => {
    expect(
      shouldInjectPlanningLoopNudge({
        planningIterations: 5,
        nudgeUsed: true,
      })
    ).toBe(false);
  });

  test("nudge message tells model to execute todos", () => {
    expect(PLANNING_LOOP_NUDGE_MESSAGE).toContain("Stop replanning");
    expect(PLANNING_LOOP_NUDGE_MESSAGE).toContain("substantive tools");
    expect(PLANNING_LOOP_NUDGE_MESSAGE).toContain("unchanged todo list");
    expect(PLANNING_LOOP_NUDGE_MESSAGE).toContain("status updates are good");
    expect(PLANNING_LOOP_NUDGE_MESSAGE).toContain("follow the user's message");
  });
});
