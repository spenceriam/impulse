import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { createGoalState } from "../src/session/goal-state.js";
import { createPlanRevision } from "../src/plan/revisions.js";
import {
  deleteGoalArtifact,
  hydrateGoalFromSession,
  readGoalArtifact,
  writeGoalArtifact,
} from "../src/goal/artifact.js";
import { getGoalDir } from "../src/goal/paths.js";
import { normalizeMode } from "../src/constants.js";

describe("goal artifact", () => {
  let tmp: string;
  const sessionId = "sess_goal_artifact_test";

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-goal-artifact-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("writes and reads back a goal without a plan reference", async () => {
    const state = createGoalState("Ship the thing");
    await writeGoalArtifact(sessionId, state, tmp);

    const goalMd = fs.readFileSync(path.join(getGoalDir(sessionId, tmp), "goal.md"), "utf-8");
    expect(goalMd).toContain("Ship the thing");
    expect(goalMd).not.toContain("## Plan reference");
    expect(goalMd).not.toContain("## Acceptance criteria");

    const read = readGoalArtifact(sessionId, tmp);
    expect(read).toEqual(state);
  });

  test("goal.md includes a plan reference and acceptance criteria section when planRevisionId is set", async () => {
    const rev = createPlanRevision(sessionId, undefined, tmp);
    const state = createGoalState("Complete all tasks", { planRevisionId: rev.meta.revisionId });
    await writeGoalArtifact(sessionId, state, tmp);

    const goalMd = fs.readFileSync(path.join(getGoalDir(sessionId, tmp), "goal.md"), "utf-8");
    expect(goalMd).toContain("## Plan reference");
    expect(goalMd).toContain(`Revision: ${rev.meta.revisionId}`);
    expect(goalMd).toContain("tasks.md");
    expect(goalMd).toContain("## Acceptance criteria");
  });

  test("state.json round-trips through readGoalArtifact with planRevisionId intact", async () => {
    const state = createGoalState("Track this", { planRevisionId: "rev-xyz" });
    await writeGoalArtifact(sessionId, state, tmp);

    const read = readGoalArtifact(sessionId, tmp);
    expect(read?.planRevisionId).toBe("rev-xyz");
  });

  test("deleteGoalArtifact removes the directory", async () => {
    const state = createGoalState("Temp goal");
    await writeGoalArtifact(sessionId, state, tmp);
    expect(readGoalArtifact(sessionId, tmp)).not.toBeNull();

    deleteGoalArtifact(sessionId, tmp);
    expect(readGoalArtifact(sessionId, tmp)).toBeNull();
  });

  test("legacy goal resume stays in memory in ASK and migrates only with AGENT authority", async () => {
    const legacyState = createGoalState("Safely hydrate the legacy goal");
    const legacyMode = normalizeMode("PLAN");
    expect(legacyMode).toBe("ASK");

    const ask = hydrateGoalFromSession({
      sessionId,
      metadataGoal: legacyState,
      mode: legacyMode,
      source: "session-hydration",
      cwd: tmp,
    });
    expect(ask.state).toEqual(legacyState);
    expect(await ask.migration).toBe(false);
    expect(fs.existsSync(getGoalDir(sessionId, tmp))).toBe(false);

    const elevated = hydrateGoalFromSession({
      sessionId,
      metadataGoal: ask.state,
      mode: "AGENT",
      source: "explicit-user-transition",
      cwd: tmp,
    });
    expect(await elevated.migration).toBe(true);
    const goalDir = getGoalDir(sessionId, tmp);
    const statePath = path.join(goalDir, "state.json");
    const goalPath = path.join(goalDir, "goal.md");
    expect(fs.existsSync(statePath)).toBe(true);
    expect(fs.existsSync(goalPath)).toBe(true);
    const stateMtime = fs.statSync(statePath).mtimeMs;
    const goalMtime = fs.statSync(goalPath).mtimeMs;

    await new Promise((resolve) => setTimeout(resolve, 10));
    const repeated = hydrateGoalFromSession({
      sessionId,
      metadataGoal: legacyState,
      mode: "AGENT",
      source: "session-hydration",
      cwd: tmp,
    });
    expect(await repeated.migration).toBe(false);
    expect(fs.statSync(statePath).mtimeMs).toBe(stateMtime);
    expect(fs.statSync(goalPath).mtimeMs).toBe(goalMtime);

    const agentResumeSession = `${sessionId}-agent-resume`;
    const agentResume = hydrateGoalFromSession({
      sessionId: agentResumeSession,
      metadataGoal: legacyState,
      mode: "AGENT",
      source: "session-hydration",
      cwd: tmp,
    });
    expect(await agentResume.migration).toBe(true);
    expect(fs.existsSync(path.join(getGoalDir(agentResumeSession, tmp), "state.json"))).toBe(true);
    expect(fs.existsSync(path.join(getGoalDir(agentResumeSession, tmp), "goal.md"))).toBe(true);
  });
});
