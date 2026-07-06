import { describe, expect, test } from "bun:test";
import { createGoalState, parseGoalState } from "../src/session/goal-state.js";

describe("createGoalState", () => {
  test("creates an active goal with default maxTurns and no planRevisionId", () => {
    const state = createGoalState("Ship the feature");
    expect(state.text).toBe("Ship the feature");
    expect(state.status).toBe("active");
    expect(state.turnsUsed).toBe(0);
    expect(state.maxTurns).toBe(20);
    expect(state.planRevisionId).toBeUndefined();
  });

  test("accepts custom maxTurns and planRevisionId via options", () => {
    const state = createGoalState("Finish tasks.md", { maxTurns: 5, planRevisionId: "2026-01-01T00-00-00-000" });
    expect(state.maxTurns).toBe(5);
    expect(state.planRevisionId).toBe("2026-01-01T00-00-00-000");
  });
});

describe("parseGoalState", () => {
  test("round-trips a goal without planRevisionId", () => {
    const original = createGoalState("Do the thing");
    const parsed = parseGoalState(JSON.parse(JSON.stringify(original)));
    expect(parsed).toEqual(original);
    expect(parsed?.planRevisionId).toBeUndefined();
  });

  test("round-trips a goal with planRevisionId", () => {
    const original = createGoalState("Do the thing", { planRevisionId: "rev-1" });
    const parsed = parseGoalState(JSON.parse(JSON.stringify(original)));
    expect(parsed?.planRevisionId).toBe("rev-1");
  });

  test("drops a non-string planRevisionId", () => {
    const parsed = parseGoalState({ text: "goal", status: "active", turnsUsed: 0, maxTurns: 20, planRevisionId: 123 });
    expect(parsed?.planRevisionId).toBeUndefined();
  });

  test("drops a blank planRevisionId", () => {
    const parsed = parseGoalState({ text: "goal", status: "active", turnsUsed: 0, maxTurns: 20, planRevisionId: "   " });
    expect(parsed?.planRevisionId).toBeUndefined();
  });

  test("returns undefined for invalid input", () => {
    expect(parseGoalState(null)).toBeUndefined();
    expect(parseGoalState({})).toBeUndefined();
    expect(parseGoalState({ text: "x", status: "bogus" })).toBeUndefined();
  });
});
