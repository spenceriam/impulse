import { describe, expect, test, afterEach } from "bun:test";
import {
  ALLOW_ALL_TODO_NUDGE_MESSAGE,
  isTodoOnlyToolBatch,
  shouldInjectAllowAllTodoNudge,
} from "../src/agent/allow-all-nudge.js";
import { isTodoWriteRealUpdate } from "../src/agent/todo-progress.js";
import { resetAllowAllBypass, setAllowAllBypass } from "../src/permission/index.js";

describe("allow-all todo nudge", () => {
  afterEach(() => {
    resetAllowAllBypass();
  });
  test("isTodoOnlyToolBatch recognizes todo_write and todo_read only", () => {
    expect(isTodoOnlyToolBatch(["todo_write"])).toBe(true);
    expect(isTodoOnlyToolBatch(["todo_read", "todo_write"])).toBe(true);
    expect(isTodoOnlyToolBatch(["todo_write", "bash"])).toBe(false);
  });

  test("isTodoWriteRealUpdate distinguishes changed vs unchanged output", () => {
    expect(isTodoWriteRealUpdate("todo_write", "Todo list updated. 3 tasks remaining.")).toBe(true);
    expect(isTodoWriteRealUpdate("todo_write", "Todos unchanged.")).toBe(false);
    expect(isTodoWriteRealUpdate("bash", "Todo list updated.")).toBe(false);
  });

  test("message defers to the user on conflict", () => {
    expect(ALLOW_ALL_TODO_NUDGE_MESSAGE).toContain("follow the user's message");
  });

  test("shouldInjectAllowAllTodoNudge requires bypass and two consecutive todo-only rounds", () => {
    expect(
      shouldInjectAllowAllTodoNudge({
        consecutiveTodoOnlyRounds: 2,
        nudgeUsed: false,
      })
    ).toBe(false);

    setAllowAllBypass(true);
    expect(
      shouldInjectAllowAllTodoNudge({
        consecutiveTodoOnlyRounds: 1,
        nudgeUsed: false,
      })
    ).toBe(false);
    expect(
      shouldInjectAllowAllTodoNudge({
        consecutiveTodoOnlyRounds: 2,
        nudgeUsed: false,
      })
    ).toBe(true);
  });
});
