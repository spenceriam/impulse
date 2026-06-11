/**
 * Main-loop iteration guard — detect no-op spirals, check in with user, hard stop at ceiling.
 */

export const LOOP_GUARD_MAX_ITERATIONS = 120;
export const LOOP_CHECKIN_MIN_ITERATIONS = 60;
export const LOOP_CHECKIN_SNOOZE_ITERATIONS = 30;
export const TODO_ONLY_FORCE_FINAL_THRESHOLD = 4;
export const PLANNING_FORCE_FINAL_THRESHOLD = 6;
export const SAME_PATH_WRITE_FORCE_FINAL_THRESHOLD = 4;

export type LoopCheckinDecision = "continue" | "finalize" | "stop";

export interface LoopGuardCounters {
  loopIteration: number;
  consecutiveTodoOnlyRounds: number;
  planningIterations: number;
  consecutiveSamePathWrites: number;
  /** Do not prompt again until this iteration count. */
  checkinSnoozedUntilIteration: number;
}

export function createLoopGuardCounters(): LoopGuardCounters {
  return {
    loopIteration: 0,
    consecutiveTodoOnlyRounds: 0,
    planningIterations: 0,
    consecutiveSamePathWrites: 0,
    checkinSnoozedUntilIteration: 0,
  };
}

export function isHeuristicTripped(counters: LoopGuardCounters): boolean {
  return (
    counters.consecutiveTodoOnlyRounds >= TODO_ONLY_FORCE_FINAL_THRESHOLD ||
    counters.planningIterations >= PLANNING_FORCE_FINAL_THRESHOLD ||
    counters.consecutiveSamePathWrites >= SAME_PATH_WRITE_FORCE_FINAL_THRESHOLD
  );
}

export function heuristicTrippedReason(counters: LoopGuardCounters): string | undefined {
  if (counters.consecutiveTodoOnlyRounds >= TODO_ONLY_FORCE_FINAL_THRESHOLD) {
    return `${counters.consecutiveTodoOnlyRounds} consecutive todo-only rounds`;
  }
  if (counters.planningIterations >= PLANNING_FORCE_FINAL_THRESHOLD) {
    return `${counters.planningIterations} non-substantive planning rounds`;
  }
  if (counters.consecutiveSamePathWrites >= SAME_PATH_WRITE_FORCE_FINAL_THRESHOLD) {
    return `${counters.consecutiveSamePathWrites} repeated writes to the same path`;
  }
  return undefined;
}

/** True only at the absolute iteration backstop. */
export function shouldForceFinal(counters: LoopGuardCounters): boolean {
  return counters.loopIteration >= LOOP_GUARD_MAX_ITERATIONS;
}

export function shouldLoopCheckin(counters: LoopGuardCounters): boolean {
  if (!isHeuristicTripped(counters)) return false;
  if (counters.loopIteration < LOOP_CHECKIN_MIN_ITERATIONS) return false;
  if (counters.loopIteration < counters.checkinSnoozedUntilIteration) return false;
  return true;
}

export function resetHeuristicCounters(counters: LoopGuardCounters): void {
  counters.consecutiveTodoOnlyRounds = 0;
  counters.planningIterations = 0;
  counters.consecutiveSamePathWrites = 0;
}

export function snoozeLoopCheckin(counters: LoopGuardCounters): void {
  counters.checkinSnoozedUntilIteration =
    counters.loopIteration + LOOP_CHECKIN_SNOOZE_ITERATIONS;
  resetHeuristicCounters(counters);
}

export function forceFinalReason(counters: LoopGuardCounters): string {
  const heuristic = heuristicTrippedReason(counters);
  if (heuristic) return heuristic;
  return `${counters.loopIteration} loop iterations`;
}
