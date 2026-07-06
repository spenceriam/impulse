import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { createGoalState } from "../src/session/goal-state.js";
import { createPlanRevision, readPlanTasksMarkdown } from "../src/plan/revisions.js";
import { buildGoalContinuationMessage, buildJudgeMessages } from "../src/agent/goal-loop.js";

describe("buildJudgeMessages", () => {
  test("uses the free-text judge prompt when no plan tasks are provided", () => {
    const goal = createGoalState("Finish the refactor");
    const [system, user] = buildJudgeMessages(goal, "I finished the refactor.");
    expect(system.content).toContain("You judge whether a coding agent goal is complete");
    expect(system.content).not.toContain("checklist");
    expect(user.content).toContain("Finish the refactor");
    expect(user.content).toContain("I finished the refactor.");
    expect(user.content).not.toContain("tasks.md");
  });

  test("uses the checklist judge prompt when plan tasks are provided", () => {
    const goal = createGoalState("Complete the plan", { planRevisionId: "rev-42" });
    const tasksMd = "- [x] task 1\n- [ ] task 2";
    const [system, user] = buildJudgeMessages(goal, "Working on task 2.", tasksMd);
    expect(system.content).toContain("checklist");
    expect(system.content).toContain("complete ONLY when every task");
    expect(user.content).toContain("rev-42");
    expect(user.content).toContain(tasksMd);
    expect(user.content).toContain("Working on task 2.");
  });

  test("slices an oversized tasks.md to the 6000-char cap", () => {
    const goal = createGoalState("Complete the plan", { planRevisionId: "rev-42" });
    const hugeTasks = "x".repeat(10_000);
    const [, user] = buildJudgeMessages(goal, "text", hugeTasks);
    // 6000 chars of tasks plus surrounding template text, but never the full 10k blob.
    expect(user.content.length).toBeLessThan(10_000);
    expect(user.content).toContain("x".repeat(6000));
  });

  test("slices an oversized last-assistant message to the 4000-char cap", () => {
    const goal = createGoalState("Finish the refactor");
    const hugeMessage = "y".repeat(10_000);
    const [, user] = buildJudgeMessages(goal, hugeMessage);
    expect(user.content).toContain("y".repeat(4000));
    expect(user.content).not.toContain("y".repeat(4001));
  });
});

describe("buildGoalContinuationMessage", () => {
  test("includes the plan tasks path when provided", () => {
    const goal = createGoalState("Complete the plan", { planRevisionId: "rev-42" });
    const msg = buildGoalContinuationMessage(goal, { planTasksPath: ".impulse/plans/s/revisions/rev-42/tasks.md" });
    expect(msg).toContain(".impulse/plans/s/revisions/rev-42/tasks.md");
    expect(msg).toContain("check them off");
  });

  test("omits the plan checklist instruction when no path is provided", () => {
    const goal = createGoalState("Finish the refactor");
    const msg = buildGoalContinuationMessage(goal);
    expect(msg).not.toContain("checklist");
  });
});

describe("readPlanTasksMarkdown", () => {
  let tmp: string;
  const sessionId = "sess_judge_plan_test";

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-judge-plan-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("returns the tasks.md content for an existing revision", () => {
    const rev = createPlanRevision(sessionId, undefined, tmp);
    fs.writeFileSync(rev.files["tasks.md"]!, "- [ ] task 1");
    expect(readPlanTasksMarkdown(sessionId, rev.meta.revisionId, tmp)).toBe("- [ ] task 1");
  });

  test("returns null when the revision doesn't exist", () => {
    expect(readPlanTasksMarkdown(sessionId, "nonexistent-revision", tmp)).toBeNull();
  });

  test("returns null when the revision exists but tasks.md hasn't been written", () => {
    const rev = createPlanRevision(sessionId, undefined, tmp);
    expect(readPlanTasksMarkdown(sessionId, rev.meta.revisionId, tmp)).toBeNull();
  });
});
