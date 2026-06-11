import { describe, expect, test } from "bun:test";
import {
  createLoopGuardCounters,
  LOOP_CHECKIN_MIN_ITERATIONS,
  LOOP_GUARD_MAX_ITERATIONS,
  PLANNING_FORCE_FINAL_THRESHOLD,
  SAME_PATH_WRITE_FORCE_FINAL_THRESHOLD,
  shouldForceFinal,
  shouldLoopCheckin,
  TODO_ONLY_FORCE_FINAL_THRESHOLD,
} from "../src/agent/loop-guard.js";

describe("loop-guard", () => {
  test("shouldForceFinal is false at defaults", () => {
    expect(shouldForceFinal(createLoopGuardCounters())).toBe(false);
  });

  test("shouldForceFinal only triggers at absolute iteration backstop", () => {
    expect(
      shouldForceFinal({
        ...createLoopGuardCounters(),
        consecutiveTodoOnlyRounds: TODO_ONLY_FORCE_FINAL_THRESHOLD,
        planningIterations: PLANNING_FORCE_FINAL_THRESHOLD,
        consecutiveSamePathWrites: SAME_PATH_WRITE_FORCE_FINAL_THRESHOLD,
      })
    ).toBe(false);

    expect(
      shouldForceFinal({
        ...createLoopGuardCounters(),
        loopIteration: LOOP_GUARD_MAX_ITERATIONS,
      })
    ).toBe(true);
  });

  test("shouldLoopCheckin requires iteration 60+ and a heuristic", () => {
    expect(
      shouldLoopCheckin({
        ...createLoopGuardCounters(),
        planningIterations: PLANNING_FORCE_FINAL_THRESHOLD,
        loopIteration: LOOP_CHECKIN_MIN_ITERATIONS - 1,
      })
    ).toBe(false);

    expect(
      shouldLoopCheckin({
        ...createLoopGuardCounters(),
        planningIterations: PLANNING_FORCE_FINAL_THRESHOLD,
        loopIteration: LOOP_CHECKIN_MIN_ITERATIONS,
      })
    ).toBe(true);

    expect(
      shouldLoopCheckin({
        ...createLoopGuardCounters(),
        planningIterations: PLANNING_FORCE_FINAL_THRESHOLD,
        loopIteration: 80,
        checkinSnoozedUntilIteration: 90,
      })
    ).toBe(false);
  });
});
