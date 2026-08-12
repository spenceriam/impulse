import { describe, expect, test } from "bun:test";
import { mkdtemp, realpath } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { HeadlessRuntime, type RuntimeTurnDriver } from "../src/runtime/session.js";
import { executionCwd } from "../src/execution/context.js";
import { effectiveApprovalPolicy } from "../src/permission/policy.js";
import { ask as askPermission } from "../src/permission/index.js";
import { getCurrentMode } from "../src/tools/mode-state.js";
import { resolveToolPath } from "../src/tools/resolve-tool-path.js";
import { Tool } from "../src/tools/registry.js";
import "../src/tools/question.js";

describe("runtime production execution context", () => {
  test("overlapping turns route ambient tool state to their owning session", async () => {
    const rootA = await realpath(await mkdtemp(join(tmpdir(), "impulse-context-a-")));
    const rootB = await realpath(await mkdtemp(join(tmpdir(), "impulse-context-b-")));
    const extraA = await realpath(await mkdtemp(join(tmpdir(), "impulse-context-extra-")));
    const observations = new Map<string, Record<string, unknown>>();
    const driver: RuntimeTurnDriver = {
      async run(context) {
        const record: Record<string, unknown> = {
          cwd: executionCwd(),
          mode: getCurrentMode(),
          approval: effectiveApprovalPolicy(),
          localPath: await resolveToolPath("local.txt", "file_write"),
        };
        if (context.session.cwd === rootA) {
          record["extraPath"] = await resolveToolPath(join(extraA, "shared.txt"), "file_write");
        }
        try {
          await resolveToolPath(
            context.session.cwd === rootA ? join(rootB, "escape.txt") : join(rootA, "escape.txt"),
            "file_write"
          );
          record["escape"] = "allowed";
        } catch {
          record["escape"] = "blocked";
        }
        await askPermission({
          sessionID: context.session.id,
          permission: "edit",
          patterns: ["local.txt"],
          message: "Edit local.txt?",
          tool: { messageID: "message-1", callID: "edit-1" },
        });
        const question = await Tool.execute("question", {
          questions: [{
            topic: "Format",
            question: "Which format?",
            options: [{ label: "Text" }, { label: "JSON" }],
          }],
        });
        record["question"] = question.output;
        observations.set(context.session.id, record);
        return { stopReason: "end-turn" };
      },
    };
    const runtime = new HeadlessRuntime({ turnDriver: driver });
    const sessionA = runtime.createSession({ cwd: rootA, additionalRoots: [extraA], mode: "AGENT" });
    const sessionB = runtime.createSession({
      cwd: rootB,
      mode: "ASK",
      config: { approvalPolicy: "allow-all" },
    });
    sessionA.onEvent((event) => {
      if (event.type === "permission-request") {
        sessionA.respondPermission(event.request.id, { outcome: "selected", optionId: "allow" });
      }
      if (event.type === "question") {
        sessionA.respondQuestion(event.request.id, { outcome: "answered", values: ["Text"] });
      }
    });
    sessionB.onEvent((event) => {
      if (event.type === "question") {
        sessionB.respondQuestion(event.request.id, { outcome: "answered", values: ["JSON"] });
      }
    });

    await Promise.all([
      sessionA.run({ text: "a", content: [{ type: "text", text: "a" }] }),
      sessionB.run({ text: "b", content: [{ type: "text", text: "b" }] }),
    ]);

    expect(observations.get(sessionA.id)).toEqual({
      cwd: rootA,
      mode: "AGENT",
      approval: "prompt",
      localPath: join(rootA, "local.txt"),
      extraPath: join(extraA, "shared.txt"),
      escape: "blocked",
      question: "User responded:\nFormat: Text",
    });
    expect(observations.get(sessionB.id)).toEqual({
      cwd: rootB,
      mode: "ASK",
      approval: "allow-all",
      localPath: join(rootB, "local.txt"),
      escape: "blocked",
      question: "User responded:\nFormat: JSON",
    });
  });
});
