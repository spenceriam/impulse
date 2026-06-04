import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import {
  createPlanRevision,
  getActivePlanRevision,
  validatePlanWritePath,
} from "../src/plan/revisions.js";
import { isToolAllowedForMode } from "../src/tools/registry.js";
import { getSubagentTools } from "../src/agent/prompts.js";

describe("plan revisions", () => {
  let tmp: string;
  const sessionId = "sess_test_123";

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-plan-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("first revision is initial and active", () => {
    const r1 = createPlanRevision(sessionId, undefined, tmp);
    expect(r1.meta.revisionId).toBe("initial");
    expect(r1.meta.active).toBe(true);

    const active = getActivePlanRevision(sessionId, tmp);
    expect(active?.meta.revisionId).toBe("initial");
  });

  test("second revision becomes active (latest wins)", () => {
    createPlanRevision(sessionId, undefined, tmp);
    const r2 = createPlanRevision(sessionId, { revises: "initial" }, tmp);
    expect(r2.meta.revises).toBe("initial");

    const active = getActivePlanRevision(sessionId, tmp);
    expect(active?.meta.revisionId).toBe(r2.meta.revisionId);
    expect(active?.meta.revisionId).not.toBe("initial");
  });

  test("validatePlanWritePath allows trio in active revision only", () => {
    const rev = createPlanRevision(sessionId, undefined, tmp);
    const design = rev.files["design.md"]!;
    expect(validatePlanWritePath(design, sessionId, tmp)).toBeNull();

    const outside = path.join(tmp, "src", "foo.ts");
    expect(validatePlanWritePath(outside, sessionId, tmp)).toContain("active revision");
  });

  test("superseded revision files are not writable", () => {
    const r1 = createPlanRevision(sessionId, undefined, tmp);
    createPlanRevision(sessionId, { revises: "initial" }, tmp);
    expect(validatePlanWritePath(r1.files["design.md"]!, sessionId, tmp)).toContain(
      "active revision"
    );
  });
});

describe("PLAN mode tool surface", () => {
  test("allows file_edit and web tools for main agent", () => {
    expect(isToolAllowedForMode("file_edit", "PLAN")).toBe(true);
    expect(isToolAllowedForMode("web_search", "PLAN")).toBe(true);
    expect(isToolAllowedForMode("bash", "PLAN")).toBe(false);
    expect(isToolAllowedForMode("plan_revision", "PLAN")).toBe(true);
    expect(isToolAllowedForMode("install_skill", "PLAN")).toBe(true);
  });

  test("explore subagent includes web tools", () => {
    const tools = getSubagentTools("explore");
    expect(tools).toContain("web_search");
    expect(tools).toContain("web_fetch");
  });
});