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
  test("advertises exactly the three direct-user choices", async () => {
    setCurrentMode("ASK");
    let payload: unknown;
    const unsubscribe = Bus.subscribe((event) => {
      if (event.type === ExecutionHandoffEvents.Asked.name) payload = event.properties;
    });
    const resultPromise = executionHandoffTool.handler({
      request: "Implement the change",
      description: "Needs project writes",
    });
    await Bun.sleep(0);
    expect(payload).toMatchObject({
      choices: ["Preview safely", "Switch to AGENT", "Stay in ASK"],
      recommended: "Preview safely",
    });
    const id = (payload as { id: string }).id;
    expect(resolveExecutionHandoff(id, "preview", Symbol("model replay"))).toBe(false);
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
