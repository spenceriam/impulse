import { describe, expect, test } from "bun:test";
import { mkdtemp, realpath } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import * as acp from "@agentclientprotocol/sdk";
import { createImpulseAcpAgent } from "../src/acp/adapter.js";
import { HeadlessRuntime, type RuntimeTurnDriver } from "../src/runtime/session.js";
import { executionHandoffTool } from "../src/tools/execution-handoff.js";

describe("ACP v1 adapter seam", () => {
  test("rejects unsupported stable and unstable MCP transports truthfully", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "impulse-acp-mcp-transport-")));
    const runtime = new HeadlessRuntime({
      turnDriver: { async run() { return { stopReason: "end-turn" }; } },
    });
    const connection = acp.client({ name: "mcp-transport-client" })
      .connect(createImpulseAcpAgent({ runtime, version: "1.10.0" }));
    try {
      await connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      const unsupported: acp.McpServer[] = [
        { type: "http", name: "http-server", url: "https://example.invalid/mcp", headers: [] },
        { type: "sse", name: "sse-server", url: "https://example.invalid/sse", headers: [] },
        { type: "acp", name: "acp-server", serverId: "server-1" },
      ];
      for (const server of unsupported) {
        await expect(connection.agent.request(acp.methods.agent.session.new, {
          cwd: root,
          mcpServers: [server],
        })).rejects.toThrow(`unsupported ${server.type} transport`);
      }
      expect(runtime.getSession("server-1")).toBeUndefined();
    } finally {
      connection.close();
      await runtime.dispose();
    }
  });

  test("awaits a session-local AGENT to ASK downgrade while another session keeps running", async () => {
    const rootA = await realpath(await mkdtemp(join(tmpdir(), "impulse-acp-revoke-a-")));
    const rootB = await realpath(await mkdtemp(join(tmpdir(), "impulse-acp-revoke-b-")));
    let startA!: () => void;
    let startB!: () => void;
    let abortA!: () => void;
    let releaseA!: () => void;
    let releaseB!: () => void;
    const startedA = new Promise<void>((resolve) => { startA = resolve; });
    const startedB = new Promise<void>((resolve) => { startB = resolve; });
    const abortedA = new Promise<void>((resolve) => { abortA = resolve; });
    const holdA = new Promise<void>((resolve) => { releaseA = resolve; });
    const holdB = new Promise<void>((resolve) => { releaseB = resolve; });
    let bAborted = false;
    const runtime = new HeadlessRuntime({
      turnDriver: {
        async run(context) {
          if (context.session.cwd === rootA) {
            startA();
            await new Promise<void>((resolve) => {
              if (context.signal.aborted) resolve();
              else context.signal.addEventListener("abort", () => resolve(), { once: true });
            });
            abortA();
            await holdA;
            return { stopReason: "cancelled" };
          }
          startB();
          context.signal.addEventListener("abort", () => { bAborted = true; }, { once: true });
          await holdB;
          return { stopReason: "end-turn" };
        },
      },
    });
    const updates: acp.SessionNotification[] = [];
    const client = acp.client({ name: "revocation-client" })
      .onNotification(acp.methods.client.session.update, ({ params }) => { updates.push(params); });
    const connection = client.connect(createImpulseAcpAgent({ runtime, version: "1.10.0" }));
    try {
      await connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      const [a, b] = await Promise.all([
        connection.agent.request(acp.methods.agent.session.new, { cwd: rootA, mcpServers: [] }),
        connection.agent.request(acp.methods.agent.session.new, { cwd: rootB, mcpServers: [] }),
      ]);
      await Promise.all([a, b].map((created) =>
        connection.agent.request(acp.methods.agent.session.setMode, {
          sessionId: created.sessionId,
          modeId: "AGENT",
        })
      ));
      const turnA = connection.agent.request(acp.methods.agent.session.prompt, {
        sessionId: a.sessionId,
        prompt: [{ type: "text", text: "hold A" }],
      });
      const turnB = connection.agent.request(acp.methods.agent.session.prompt, {
        sessionId: b.sessionId,
        prompt: [{ type: "text", text: "hold B" }],
      });
      await Promise.all([startedA, startedB]);

      let downgradeSettled = false;
      const downgrade = connection.agent.request(acp.methods.agent.session.setMode, {
        sessionId: a.sessionId,
        modeId: "ASK",
      }).then(() => { downgradeSettled = true; });
      await abortedA;
      expect(downgradeSettled).toBe(false);
      expect(runtime.getSession(a.sessionId)?.snapshot().mode).toBe("AGENT");
      expect(runtime.getSession(b.sessionId)?.snapshot().mode).toBe("AGENT");
      expect(bAborted).toBe(false);

      releaseA();
      await downgrade;
      expect(await turnA).toEqual({ stopReason: "cancelled" });
      expect(runtime.getSession(a.sessionId)?.snapshot().mode).toBe("ASK");
      expect(updates.filter((entry) =>
        entry.sessionId === a.sessionId &&
        entry.update.sessionUpdate === "current_mode_update" &&
        entry.update.currentModeId === "ASK"
      )).toHaveLength(1);
      expect(runtime.getSession(b.sessionId)?.snapshot().turnActive).toBe(true);

      releaseB();
      expect(await turnB).toEqual({ stopReason: "end_turn" });
      expect(bAborted).toBe(false);
    } finally {
      releaseA?.();
      releaseB?.();
      connection.close();
      await runtime.dispose();
    }
  });

  test("truthfully maps independent runtime sessions through the official SDK", async () => {
    const rootA = await realpath(await mkdtemp(join(tmpdir(), "impulse-acp-a-")));
    const rootB = await realpath(await mkdtemp(join(tmpdir(), "impulse-acp-b-")));
    const extraA = await realpath(await mkdtemp(join(tmpdir(), "impulse-acp-extra-")));
    const driver: RuntimeTurnDriver = {
      async run(context) {
        context.emit({ type: "thinking-token", text: `think:${context.prompt.text}` });
        context.emit({ type: "assistant-token", text: `answer:${context.prompt.text}` });
        context.emit({
          type: "tool-start",
          id: `tool:${context.session.id}`,
          name: "file_write",
          title: "Write result",
          kind: "edit",
          locations: [{ path: join(context.session.cwd, "result.txt"), line: 1 }],
          rawInput: { path: "result.txt" },
        });
        const permission = await context.requestPermission({
          toolCallId: `tool:${context.session.id}`,
          title: "Write result",
          kind: "edit",
          options: [
            { id: "allow", label: "Allow", kind: "allow-once" },
            { id: "reject", label: "Reject", kind: "reject-once" },
          ],
        });
        const answer = await context.requestQuestion({
          prompt: "Continue?",
          choices: [{ id: "yes", label: "Yes" }],
        });
        context.emit({
          type: "tool-end",
          id: `tool:${context.session.id}`,
          name: "file_write",
          success: permission.outcome === "selected",
          output: answer.outcome === "cancelled" ? "question unavailable" : "done",
          durationMs: 7,
          rawOutput: { permission, answer },
        });
        context.emit({
          type: "plan",
          id: "plan-1",
          entries: [{ id: "one", content: "Write result", priority: "high", status: "completed" }],
        });
        return {
          stopReason: "end-turn",
          usage: { inputTokens: 8, outputTokens: 4, contextTokens: 12, contextWindow: 1000 },
        };
      },
    };
    const runtime = new HeadlessRuntime({ turnDriver: driver });
    const agentApp = createImpulseAcpAgent({ runtime, version: "1.10.0" });
    const updates = new Map<string, acp.SessionUpdate[]>();
    const permissionSessions: string[] = [];
    const clientApp = acp
      .client({ name: "impulse-test-client" })
      .onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
        permissionSessions.push(params.sessionId);
        return { outcome: { outcome: "selected", optionId: "allow" } };
      })
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        const list = updates.get(params.sessionId) ?? [];
        list.push(params.update);
        updates.set(params.sessionId, list);
      });
    const connection = clientApp.connect(agentApp);
    try {
      const initialized = await connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: "fixture", version: "1" },
      });
      expect(initialized).toMatchObject({
        protocolVersion: acp.PROTOCOL_VERSION,
        agentInfo: { name: "impulse", version: "1.10.0" },
        agentCapabilities: {
          loadSession: false,
          sessionCapabilities: { additionalDirectories: {}, close: {} },
        },
      });
      expect(initialized.agentCapabilities?.sessionCapabilities?.list).toBeUndefined();
      expect(initialized.agentCapabilities?.sessionCapabilities?.resume).toBeUndefined();
      expect(initialized.agentCapabilities?.sessionCapabilities?.delete).toBeUndefined();

      const [createdA, createdB] = await Promise.all([
        connection.agent.request(acp.methods.agent.session.new, {
          cwd: rootA,
          additionalDirectories: [extraA],
          mcpServers: [],
        }),
        connection.agent.request(acp.methods.agent.session.new, { cwd: rootB, mcpServers: [] }),
      ]);
      expect(createdA.modes?.currentModeId).toBe("ASK");
      expect(createdB.modes?.currentModeId).toBe("ASK");
      expect(createdA.configOptions?.find((option) => option.id === "density")).toMatchObject({
        type: "select",
        currentValue: "compact",
      });

      await connection.agent.request(acp.methods.agent.session.setMode, {
        sessionId: createdA.sessionId,
        modeId: "AGENT",
      });
      await connection.agent.request(acp.methods.agent.session.setConfigOption, {
        sessionId: createdB.sessionId,
        configId: "density",
        value: "comfy",
      });
      await connection.agent.request(acp.methods.agent.session.setConfigOption, {
        sessionId: createdB.sessionId,
        configId: "approvalPolicy",
        value: "allow-all",
      });

      const [promptA, promptB] = await Promise.all([
        connection.agent.request(acp.methods.agent.session.prompt, {
          sessionId: createdA.sessionId,
          prompt: [
            { type: "text", text: "alpha" },
            { type: "resource_link", name: "notes", uri: "file:///notes.md" },
          ],
        }),
        connection.agent.request(acp.methods.agent.session.prompt, {
          sessionId: createdB.sessionId,
          prompt: [{ type: "text", text: "beta" }],
        }),
      ]);
      expect(promptA.stopReason).toBe("end_turn");
      expect(promptB.stopReason).toBe("end_turn");
      expect(permissionSessions).toEqual([createdA.sessionId]);

      for (const sessionId of [createdA.sessionId, createdB.sessionId]) {
        const kinds = (updates.get(sessionId) ?? []).map((update) => update.sessionUpdate);
        expect(kinds).not.toContain("available_commands_update");
        expect(kinds).toContain("current_mode_update");
        expect(kinds).toContain("config_option_update");
        expect(kinds).toContain("agent_message_chunk");
        expect(kinds).toContain("agent_thought_chunk");
        expect(kinds).toContain("tool_call");
        expect(kinds).toContain("tool_call_update");
        expect(kinds).toContain("plan");
        expect(kinds).toContain("usage_update");
      }

      await connection.agent.request(acp.methods.agent.session.close, { sessionId: createdA.sessionId });
      expect(runtime.getSession(createdA.sessionId)).toBeUndefined();
      const secondB = await connection.agent.request(acp.methods.agent.session.prompt, {
        sessionId: createdB.sessionId,
        prompt: [{ type: "text", text: "still alive" }],
      });
      expect(secondB.stopReason).toBe("end_turn");
    } finally {
      connection.close();
      await runtime.dispose();
    }
  });

  test("permission rejection/cancellation and turn cancellation are isolated", async () => {
    const rootA = await realpath(await mkdtemp(join(tmpdir(), "impulse-acp-cancel-a-")));
    const rootB = await realpath(await mkdtemp(join(tmpdir(), "impulse-acp-cancel-b-")));
    const driver: RuntimeTurnDriver = {
      async run(context) {
        context.emit({ type: "assistant-token", text: `started:${context.prompt.text}` });
        if (context.prompt.text === "wait") {
          await new Promise<void>((resolve) => {
            if (context.signal.aborted) resolve();
            else context.signal.addEventListener("abort", () => resolve(), { once: true });
          });
          return { stopReason: "cancelled" };
        }
        const outcome = await context.requestPermission({
          toolCallId: `permission:${context.prompt.text}`,
          title: context.prompt.text,
          kind: "execute",
          options: [
            { id: "allow", label: "Allow", kind: "allow-once" },
            { id: "reject", label: "Reject", kind: "reject-once" },
          ],
          rawInput: { case: context.prompt.text },
        });
        context.emit({
          type: "tool-end",
          id: `permission:${context.prompt.text}`,
          name: "bash",
          success: outcome.outcome === "selected" && outcome.optionId === "allow",
          output: outcome.outcome === "cancelled" ? "cancelled" : outcome.optionId,
          durationMs: 1,
          rawOutput: outcome,
        });
        return { stopReason: "end-turn" };
      },
    };
    const runtime = new HeadlessRuntime({ turnDriver: driver });
    const agentApp = createImpulseAcpAgent({ runtime, version: "1.10.0" });
    const updates: acp.SessionNotification[] = [];
    let waitSessionId = "";
    let waitStarted!: () => void;
    const waitStartedPromise = new Promise<void>((resolve) => { waitStarted = resolve; });
    const clientApp = acp
      .client({ name: "permission-client" })
      .onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
        const requestCase = (params.toolCall.rawInput as { case?: string } | undefined)?.case;
        return requestCase === "cancel"
          ? { outcome: { outcome: "cancelled" as const } }
          : { outcome: { outcome: "selected" as const, optionId: "reject" } };
      })
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        updates.push(params);
        if (
          params.sessionId === waitSessionId &&
          params.update.sessionUpdate === "agent_message_chunk" &&
          params.update.content.type === "text" &&
          params.update.content.text.includes("started:wait")
        ) waitStarted();
      });
    const connection = clientApp.connect(agentApp);
    try {
      await connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      const a = await connection.agent.request(acp.methods.agent.session.new, { cwd: rootA, mcpServers: [] });
      const b = await connection.agent.request(acp.methods.agent.session.new, { cwd: rootB, mcpServers: [] });
      waitSessionId = a.sessionId;

      const rejected = await connection.agent.request(acp.methods.agent.session.prompt, {
        sessionId: b.sessionId,
        prompt: [{ type: "text", text: "reject" }],
      });
      const permissionCancelled = await connection.agent.request(acp.methods.agent.session.prompt, {
        sessionId: b.sessionId,
        prompt: [{ type: "text", text: "cancel" }],
      });
      expect(rejected.stopReason).toBe("end_turn");
      expect(permissionCancelled.stopReason).toBe("end_turn");
      const permissionOutputs = updates.flatMap((notification) => {
        const update = notification.update;
        return update.sessionUpdate === "tool_call_update" ? [update.rawOutput] : [];
      });
      expect(permissionOutputs).toContainEqual({ outcome: "selected", optionId: "reject" });
      expect(permissionOutputs).toContainEqual({ outcome: "cancelled" });

      const waiting = connection.agent.request(acp.methods.agent.session.prompt, {
        sessionId: a.sessionId,
        prompt: [{ type: "text", text: "wait" }],
      });
      await waitStartedPromise;
      await connection.agent.notify(acp.methods.agent.session.cancel, { sessionId: a.sessionId });
      expect(await waiting).toEqual({ stopReason: "cancelled" });

      const alive = await connection.agent.request(acp.methods.agent.session.prompt, {
        sessionId: b.sessionId,
        prompt: [{ type: "text", text: "reject" }],
      });
      expect(alive.stopReason).toBe("end_turn");
    } finally {
      connection.close();
      await runtime.dispose();
    }
  });

  test("uses draft elicitation and plan updates only when the client opts in", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "impulse-acp-draft-")));
    const driver: RuntimeTurnDriver = {
      async run(context) {
        context.emit({
          type: "plan",
          id: "draft-plan",
          entries: [{ id: "one", content: "Ask first", priority: "high", status: "in-progress" }],
        });
        const answer = await context.requestQuestion({
          prompt: "Choose a path",
          choices: [
            { id: "safe", label: "Safe" },
            { id: "fast", label: "Fast" },
          ],
        });
        context.emit({
          type: "plan-update",
          id: "draft-plan",
          entries: [{ id: "one", content: "Ask first", priority: "high", status: "completed" }],
        });
        context.emit({
          type: "tool-end",
          id: "question-result",
          name: "question",
          success: answer.outcome === "answered",
          output: answer.outcome === "answered" ? answer.values.join(",") : "cancelled",
          durationMs: 1,
          rawOutput: answer,
        });
        return { stopReason: "end-turn" };
      },
    };
    const runtime = new HeadlessRuntime({ turnDriver: driver });
    const agentApp = createImpulseAcpAgent({ runtime, version: "1.10.0" });
    const updates: acp.SessionUpdate[] = [];
    const elicitationRequests: acp.CreateElicitationRequest[] = [];
    const clientApp = acp
      .client({ name: "draft-capability-client" })
      .onRequest(acp.methods.client.elicitation.create, ({ params }) => {
        elicitationRequests.push(params);
        return { action: "accept", content: { answer: "safe" } };
      })
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        updates.push(params.update);
      });
    const connection = clientApp.connect(agentApp);
    try {
      await connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { elicitation: { form: {} }, plan: {} },
      });
      const created = await connection.agent.request(acp.methods.agent.session.new, {
        cwd: root,
        mcpServers: [],
      });
      const result = await connection.agent.request(acp.methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "ask me" }],
      });

      expect(result.stopReason).toBe("end_turn");
      expect(elicitationRequests).toHaveLength(1);
      expect(elicitationRequests[0]).toMatchObject({
        mode: "form",
        sessionId: created.sessionId,
        message: "Choose a path",
      });
      expect(updates.some((update) => update.sessionUpdate === "plan")).toBe(true);
      expect(updates).toContainEqual(expect.objectContaining({
        sessionUpdate: "plan_update",
        plan: expect.objectContaining({ type: "items", planId: "draft-plan" }),
      }));
      expect(updates).toContainEqual(expect.objectContaining({
        sessionUpdate: "tool_call_update",
        rawOutput: { outcome: "answered", values: ["safe"] },
      }));
    } finally {
      connection.close();
      await runtime.dispose();
    }
  });

  test("bridges ASK execution handoff choices through ACP form elicitation", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "impulse-acp-handoff-")));
    let handoffOutput = "";
    const runtime = new HeadlessRuntime({
      turnDriver: {
        async run() {
          const result = await executionHandoffTool.handler({
            request: "Implement the requested change",
            description: "Project writes are required",
          });
          handoffOutput = result.output;
          return { stopReason: "end-turn" };
        },
      },
    });
    const requests: acp.CreateElicitationRequest[] = [];
    const updates: acp.SessionUpdate[] = [];
    const client = acp.client({ name: "handoff-client" })
      .onRequest(acp.methods.client.elicitation.create, ({ params }) => {
        requests.push(params);
        return { action: "accept", content: { answer: "agent" } };
      })
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        updates.push(params.update);
      });
    const connection = client.connect(createImpulseAcpAgent({ runtime, version: "1.10.0" }));
    try {
      await connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { elicitation: { form: {} } },
      });
      const created = await connection.agent.request(acp.methods.agent.session.new, {
        cwd: root,
        mcpServers: [],
      });
      expect((await connection.agent.request(acp.methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "please implement" }],
      })).stopReason).toBe("end_turn");

      expect(requests).toHaveLength(1);
      expect(JSON.stringify(requests[0]?.requestedSchema)).toContain("Preview safely");
      expect(JSON.stringify(requests[0]?.requestedSchema)).toContain("Switch to AGENT");
      expect(JSON.stringify(requests[0]?.requestedSchema)).toContain("Stay in ASK");
      expect(handoffOutput).toContain("Execution authority is now enabled");
      expect(runtime.getSession(created.sessionId)?.snapshot().mode).toBe("AGENT");
      expect(updates).toContainEqual(expect.objectContaining({
        sessionUpdate: "current_mode_update",
        currentModeId: "AGENT",
      }));
    } finally {
      connection.close();
      await runtime.dispose();
    }
  });

  test("ACP clients without form elicitation stay in ASK without hanging", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "impulse-acp-handoff-fallback-")));
    let handoffOutput = "";
    const runtime = new HeadlessRuntime({
      turnDriver: {
        async run() {
          const result = await executionHandoffTool.handler({
            request: "Implement the requested change",
            description: "Project writes are required",
          });
          handoffOutput = result.output;
          return { stopReason: "end-turn" };
        },
      },
    });
    const connection = acp.client({ name: "handoff-fallback-client" })
      .connect(createImpulseAcpAgent({ runtime, version: "1.10.0" }));
    try {
      await connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      const created = await connection.agent.request(acp.methods.agent.session.new, {
        cwd: root,
        mcpServers: [],
      });
      const turn = await Promise.race([
        connection.agent.request(acp.methods.agent.session.prompt, {
          sessionId: created.sessionId,
          prompt: [{ type: "text", text: "please implement" }],
        }),
        Bun.sleep(500).then(() => null),
      ]);
      expect(turn).toEqual({ stopReason: "end_turn" });
      expect(handoffOutput).toContain("unavailable in this client");
      expect(runtime.getSession(created.sessionId)?.snapshot().mode).toBe("ASK");
    } finally {
      connection.close();
      await runtime.dispose();
    }
  });

  test("cancelling a turn cancels an outstanding client permission request", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "impulse-acp-pending-permission-")));
    let permissionStarted!: () => void;
    const permissionStartedPromise = new Promise<void>((resolve) => { permissionStarted = resolve; });
    let outgoingRequestAborted = false;
    const runtime = new HeadlessRuntime({
      turnDriver: {
        async run(context) {
          await context.requestPermission({
            toolCallId: "long-permission",
            title: "Long permission",
            kind: "execute",
            options: [{ id: "allow", label: "Allow", kind: "allow-once" }],
          });
          return { stopReason: "end-turn" };
        },
      },
    });
    const clientApp = acp
      .client({ name: "pending-permission-client" })
      .onRequest(acp.methods.client.session.requestPermission, async ({ signal }) => {
        permissionStarted();
        await Promise.race([
          new Promise<void>((resolve) => {
            if (signal.aborted) {
              outgoingRequestAborted = true;
              resolve();
            } else {
              signal.addEventListener("abort", () => {
                outgoingRequestAborted = true;
                resolve();
              }, { once: true });
            }
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 250)),
        ]);
        return { outcome: { outcome: "cancelled" as const } };
      });
    const connection = clientApp.connect(createImpulseAcpAgent({ runtime, version: "1.10.0" }));
    try {
      await connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      const created = await connection.agent.request(acp.methods.agent.session.new, {
        cwd: root,
        mcpServers: [],
      });
      const turn = connection.agent.request(acp.methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "cancel permission" }],
      });
      await permissionStartedPromise;
      await connection.agent.notify(acp.methods.agent.session.cancel, { sessionId: created.sessionId });

      expect(await turn).toEqual({ stopReason: "cancelled" });
      expect(outgoingRequestAborted).toBe(true);
    } finally {
      connection.close();
      await runtime.dispose();
    }
  });
});
