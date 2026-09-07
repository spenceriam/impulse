import { afterEach, describe, expect, test } from "bun:test";
import { Bus } from "../src/bus/index.js";
import {
  ExecutionHandoffEvents,
  executionHandoffTool,
  hasPendingExecutionHandoff,
  resolveExecutionHandoff,
  USER_HANDOFF_AUTHORITY,
} from "../src/tools/execution-handoff.js";
import { setCurrentMode } from "../src/tools/mode-state.js";
import { taskModeError } from "../src/tools/task-authority.js";

afterEach(() => {
  if (hasPendingExecutionHandoff()) {
    resolveExecutionHandoff("test", "stay", USER_HANDOFF_AUTHORITY);
  }
});

describe("ASK execution handoff", () => {
  test("advertises exactly the two direct-user choices", async () => {
    setCurrentMode("ASK");
    let payload: unknown;
    const unsubscribe = Bus.subscribe((event) => {
      if (event.type === ExecutionHandoffEvents.Asked.name) payload = event.properties;
    });
    const resultPromise = executionHandoffTool.handler({
      request: "Implement the change",
      description: "Needs project writes",
    });
    if (!payload || typeof payload !== "object" || !("id" in payload) || typeof payload.id !== "string") {
      throw new Error("handoff event was not published");
    }
    expect(payload).toMatchObject({
      choices: ["Switch to AGENT", "Stay in ASK"],
    });
    const id = payload.id;
    expect(resolveExecutionHandoff(id, "agent", Symbol("model replay"))).toBe(false);
    expect(hasPendingExecutionHandoff()).toBe(true);
    expect(resolveExecutionHandoff(id, "stay", USER_HANDOFF_AUTHORITY)).toBe(true);
    expect(resolveExecutionHandoff(id, "agent", USER_HANDOFF_AUTHORITY)).toBe(false);
    expect((await resultPromise).output).toContain("Stay in ASK");
    unsubscribe();
  });

  test("general delegation guidance points to handoff while explore remains available", () => {
    expect(taskModeError("ASK", "general")).toContain("execution_handoff");
    expect(taskModeError("ASK", "explore")).toBeNull();
  });
});
