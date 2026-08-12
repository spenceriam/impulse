import { afterEach, describe, expect, test } from "bun:test";
import fsSync from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Tool, isToolAllowedForMode } from "../src/tools/registry.js";
import { getCurrentMode, setCurrentMode } from "../src/tools/mode-state.js";
import { Bus, ModeEvents } from "../src/bus/index.js";
import { enterAgentModeForTest } from "./helpers/authority.js";
import {
  abortUserShell,
  isUserShellActive,
  runUserShellCommand,
} from "../src/cli/user-shell.js";
import {
  countActiveAgentTurnExecutions,
  registerAgentTurnExecution,
} from "../src/session/turn-execution.js";
import "../src/tools/file-read.js";
import "../src/tools/file-write.js";
import "../src/tools/file-edit.js";
import "../src/tools/bash.js";
import "../src/tools/bg-output.js";
import "../src/tools/install-skill.js";
import "../src/tools/skill-write.js";
import "../src/tools/skill-remove.js";
import "../src/tools/user-instructions.js";
import "../src/tools/question.js";
import "../src/tools/todo-write.js";
import "../src/tools/set-header.js";
import "../src/tools/task.js";
import "../src/tools/set-mode.js";
import "../src/tools/execution-handoff.js";

function definitionNames(mode: "ASK" | "AGENT"): string[] {
  return Tool.getAPIDefinitionsForMode(mode).map((definition) => definition.function.name);
}

describe("mode tool authority", () => {
  afterEach(async () => {
    await abortUserShell();
    setCurrentMode("ASK");
  });

  test("ASK exposes read/session tools but blocks mutation and general subagents at execution", async () => {
    const ask = definitionNames("ASK");
    const agent = definitionNames("AGENT");

    for (const name of ["file_read", "question", "execution_handoff", "todo_write", "set_header", "task", "set_mode"]) {
      expect(ask).toContain(name);
    }
    for (const name of [
      "file_write",
      "file_edit",
      "bash",
      "bg_kill",
      "install_skill",
      "skill_write",
      "skill_remove",
      "user_instructions",
    ]) {
      expect(ask).not.toContain(name);
      expect(agent).toContain(name);
      expect(isToolAllowedForMode(name, "ASK")).toBe(false);
      expect(isToolAllowedForMode(name, "AGENT")).toBe(true);
    }

    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "impulse-mode-tools-"));
    const originalCwd = process.cwd();
    const target = path.join(temp, "authority.txt");
    try {
      process.chdir(temp);
      setCurrentMode("ASK");
      const deniedWrite = await Tool.execute("file_write", {
        filePath: target,
        content: "denied",
      });
      expect(deniedWrite.success).toBe(false);
      expect(deniedWrite.output).toContain('not allowed in ASK mode');
      expect(Bun.file(target).size).toBe(0);

      const deniedGeneral = await Tool.execute("task", {
        prompt: "Change the project",
        description: "Mutating delegation",
        subagent_type: "general",
      });
      expect(deniedGeneral.success).toBe(false);
      expect(deniedGeneral.output).toContain("ASK mode only allows explore subagents");

      await enterAgentModeForTest();
      const allowedWrite = await Tool.execute("file_write", {
        filePath: target,
        content: "allowed",
      });
      expect(allowedWrite.success).toBe(true);
      expect(await fs.readFile(target, "utf-8")).toBe("allowed");
    } finally {
      process.chdir(originalCwd);
      await fs.rm(temp, { recursive: true, force: true });
    }
  });

  test("model set_mode can de-escalate but cannot elevate ASK without the user", async () => {
    const changes: Array<{ mode: string; reason?: string }> = [];
    let temp: string | null = null;
    let shellRun: ReturnType<typeof runUserShellCommand> | null = null;
    let turn: ReturnType<typeof registerAgentTurnExecution> | null = null;
    const unsubscribe = Bus.subscribe((event) => {
      if (event.type === ModeEvents.Changed.name) {
        changes.push(event.properties as { mode: string; reason?: string });
      }
    });

    try {
      setCurrentMode("ASK");
      const escalation = await Tool.execute("set_mode", {
        mode: "AGENT",
        reason: "Need to edit files",
      });
      expect(escalation.success).toBe(false);
      expect(escalation.output).toContain("User confirmation is required");
      expect(escalation.output).toContain("execution_handoff");
      expect(escalation.output).toContain("Switch to AGENT");
      expect(changes).toEqual([]);

      await enterAgentModeForTest();
      temp = await fs.mkdtemp(path.join(os.tmpdir(), "impulse-model-shell-revoke-"));
      const counterPath = path.join(temp, "counter.txt");
      const command = process.platform === "win32"
        ? `while ($true) { Add-Content -Path '${counterPath.replaceAll("'", "''")}' -Value x; Start-Sleep -Milliseconds 20 }`
        : `while true; do printf 'x\\n' >> ${JSON.stringify(counterPath)}; sleep 0.02; done`;
      shellRun = runUserShellCommand({ command, onData: () => {} });
      const count = () => {
        if (!fsSync.existsSync(counterPath)) return 0;
        return fsSync.readFileSync(counterPath, "utf-8").trim().split("\n").filter(Boolean).length;
      };
      const deadline = Date.now() + 3_000;
      while (count() < 3) {
        if (Date.now() >= deadline) throw new Error("Timed out waiting for model shell loop");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      const turnController = new AbortController();
      turn = registerAgentTurnExecution(() => turnController.abort());
      const deescalation = await Tool.execute("set_mode", {
        mode: "ASK",
        reason: "Research only",
      });
      expect(deescalation.success).toBe(true);
      expect(deescalation.output).toContain("De-escalation to ASK is pending");
      expect(deescalation.output).toContain("Mode remains AGENT");
      expect(deescalation.output).not.toContain("Mode switched to ASK");
      expect(deescalation.metadata).toMatchObject({
        mode: "AGENT",
        requestedMode: "ASK",
        pending: true,
      });
      expect(changes).toEqual([]);
      expect(getCurrentMode()).toBe("AGENT");
      expect(turnController.signal.aborted).toBe(true);
      expect(countActiveAgentTurnExecutions()).toBe(1);

      turn.complete();
      const transitionDeadline = Date.now() + 3_000;
      while (getCurrentMode() !== "ASK") {
        if (Date.now() >= transitionDeadline) {
          throw new Error("Timed out waiting for deferred model de-escalation");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(changes).toEqual([{ mode: "ASK", reason: "Research only" }]);
      expect(countActiveAgentTurnExecutions()).toBe(0);
      expect(isUserShellActive()).toBe(false);
      const stoppedCount = count();
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(count()).toBe(stoppedCount);
    } finally {
      turn?.complete();
      await abortUserShell();
      if (shellRun) await shellRun;
      if (temp) await fs.rm(temp, { recursive: true, force: true });
      unsubscribe();
    }
  }, 15_000);
});
