import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { createPlanRevision } from "../src/plan/revisions.js";
import {
  checkPlanCompletionHandoff,
  planCompletionToolBehavior,
} from "../src/agent/plan-completion.js";

describe("checkPlanCompletionHandoff", () => {
  let tmp: string;
  const sessionId = "sess_handoff_test";

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-plan-handoff-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("returns null when the current mode isn't PLAN", () => {
    const rev = createPlanRevision(sessionId, undefined, tmp);
    fs.writeFileSync(rev.files["tasks.md"]!, "- [ ] task 1");
    expect(checkPlanCompletionHandoff("AGENT", "AGENT", sessionId, tmp)).toBeNull();
  });

  test("returns null when the requested mode isn't AGENT", () => {
    const rev = createPlanRevision(sessionId, undefined, tmp);
    fs.writeFileSync(rev.files["tasks.md"]!, "- [ ] task 1");
    expect(checkPlanCompletionHandoff("PLAN", "EXPLORE", sessionId, tmp)).toBeNull();
  });

  test("returns null when there is no active plan revision", () => {
    expect(checkPlanCompletionHandoff("PLAN", "AGENT", sessionId, tmp)).toBeNull();
  });

  test("returns null when tasks.md hasn't been written yet", () => {
    createPlanRevision(sessionId, undefined, tmp);
    expect(checkPlanCompletionHandoff("PLAN", "AGENT", sessionId, tmp)).toBeNull();
  });

  test("returns handoff paths when PLAN artifacts (tasks.md) exist", () => {
    const rev = createPlanRevision(sessionId, undefined, tmp);
    fs.writeFileSync(rev.files["tasks.md"]!, "- [ ] task 1\n- [ ] task 2");

    const handoff = checkPlanCompletionHandoff("PLAN", "AGENT", sessionId, tmp);
    expect(handoff).not.toBeNull();
    expect(handoff!.tasksPathRel).toContain("tasks.md");
    expect(handoff!.planDirRel).toContain(rev.meta.revisionId);
  });
});

describe("planCompletionToolBehavior", () => {
  const tasksPathRel = ".impulse/plans/s/revisions/r/tasks.md";

  test("execute switches mode and instructs immediate implementation", () => {
    const behavior = planCompletionToolBehavior("execute", tasksPathRel);
    expect(behavior.performSwitch).toBe(true);
    expect(behavior.output).toContain(tasksPathRel);
    expect(behavior.output).toContain("EXECUTE");
  });

  test("proceed switches mode and waits for the next instruction", () => {
    const behavior = planCompletionToolBehavior("proceed", tasksPathRel);
    expect(behavior.performSwitch).toBe(true);
    expect(behavior.output).toContain("PROCEED");
  });

  test("revise does not switch mode", () => {
    const behavior = planCompletionToolBehavior("revise", tasksPathRel);
    expect(behavior.performSwitch).toBe(false);
    expect(behavior.output).toContain("REVISE");
  });

  test("cancel does not switch mode", () => {
    const behavior = planCompletionToolBehavior("cancel", tasksPathRel);
    expect(behavior.performSwitch).toBe(false);
    expect(behavior.output).toContain("cancelled");
  });
});
