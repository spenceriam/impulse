import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  getAdvisorToolDefinitionForMode,
  invokeAdvisorForMode,
} from "../src/agent/advisor-authority.js";

const enabledAdvisor = {
  advisorMode: true,
  advisorModel: "provider/advisor-model",
  experimental: { advisor: true },
};

describe("advisor workflow authority", () => {
  test("advisor tool advertisement requires AGENT and the existing feature flags", () => {
    expect(getAdvisorToolDefinitionForMode("ASK", enabledAdvisor)).toBeNull();
    expect(
      getAdvisorToolDefinitionForMode("AGENT", enabledAdvisor)?.function.name
    ).toBe("consult_advisor");
    expect(
      getAdvisorToolDefinitionForMode("AGENT", {
        ...enabledAdvisor,
        advisorMode: false,
      })
    ).toBeNull();
    expect(
      getAdvisorToolDefinitionForMode("AGENT", {
        ...enabledAdvisor,
        experimental: { advisor: false },
      })
    ).toBeNull();
  });

  test("direct model dispatch cannot call or persist advisor work in ASK", async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-advisor-dispatch-"));
    const planPath = path.join(project, "advisor-plan.md");
    let calls = 0;
    const invoke = async () => {
      calls++;
      fs.writeFileSync(planPath, "advisor plan");
      return planPath;
    };

    try {
      const ask = await invokeAdvisorForMode({
        mode: "ASK",
        config: enabledAdvisor,
        source: "direct-model-dispatch",
        invoke,
      });
      expect(ask.executed).toBe(false);
      expect(ask.reason).toContain("switch to AGENT");
      expect(calls).toBe(0);
      expect(fs.existsSync(planPath)).toBe(false);

      const agent = await invokeAdvisorForMode({
        mode: "AGENT",
        config: enabledAdvisor,
        source: "direct-model-dispatch",
        invoke,
      });
      expect(agent.executed).toBe(true);
      expect(calls).toBe(1);
      expect(fs.existsSync(planPath)).toBe(true);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  test("automatic stuck-loop invocation cannot call or persist advisor work in ASK", async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-advisor-automatic-"));
    const planPath = path.join(project, "advisor-plan.md");
    let calls = 0;
    const invoke = async () => {
      calls++;
      fs.writeFileSync(planPath, "automatic advisor plan");
      return planPath;
    };

    try {
      const ask = await invokeAdvisorForMode({
        mode: "ASK",
        config: enabledAdvisor,
        source: "automatic-stuck-loop",
        invoke,
      });
      expect(ask.executed).toBe(false);
      expect(calls).toBe(0);
      expect(fs.existsSync(planPath)).toBe(false);

      const agent = await invokeAdvisorForMode({
        mode: "AGENT",
        config: enabledAdvisor,
        source: "automatic-stuck-loop",
        invoke,
      });
      expect(agent.executed).toBe(true);
      expect(calls).toBe(1);
      expect(fs.existsSync(planPath)).toBe(true);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
