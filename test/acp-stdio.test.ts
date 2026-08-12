import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { mkdtemp, readFile, realpath } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import * as acp from "@agentclientprotocol/sdk";

const acpEntry = process.env["IMPULSE_ACP_ENTRY"] ?? "src/index.ts";

describe("impulse --acp stdio", () => {
  test("owns a stable-v1 stdio MCP server per session under prompt and allow-all policies", async () => {
    const fixture = join(process.cwd(), "test/fixtures/mcp-stdio-server.ts");
    for (const allowAll of [false, true]) {
      const rootA = await realpath(await mkdtemp(join(tmpdir(), `impulse-mcp-owner-${allowAll}-`)));
      const rootB = await realpath(await mkdtemp(join(tmpdir(), `impulse-mcp-other-${allowAll}-`)));
      const exitFile = join(rootA, "mcp-exit.txt");
      const markerFile = join(rootA, "mcp-marker.txt");
      const child = spawn(
        process.execPath,
        [acpEntry, "--acp", ...(allowAll ? ["--allow-all"] : [])],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            NODE_ENV: "test",
            IMPULSE_ACP_TEST_DRIVER: "scripted",
          },
          stdio: ["pipe", "pipe", "pipe"],
        }
      );
      const webStdout = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
      const [protocolOutput, auditOutput] = webStdout.tee();
      const rawStdoutPromise = new Response(auditOutput).text();
      const rawStderrPromise = new Response(
        Readable.toWeb(child.stderr) as ReadableStream<Uint8Array>
      ).text();
      const updates: acp.SessionNotification[] = [];
      const permissionSessions: string[] = [];
      const clientApp = acp
        .client({ name: `mcp-fixture-${allowAll}` })
        .onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
          permissionSessions.push(params.sessionId);
          return { outcome: { outcome: "selected" as const, optionId: "allow" } };
        })
        .onNotification(acp.methods.client.session.update, ({ params }) => {
          updates.push(params);
        });
      const connection = clientApp.connect(acp.ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        protocolOutput
      ));
      try {
        const initialized = await connection.agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
        });
        // Stable ACP v1 has no stdio flag in McpCapabilities; accepting the
        // session config itself is the truthful capability signal.
        expect(initialized.agentCapabilities?.mcpCapabilities).toBeUndefined();
        const owner = await connection.agent.request(acp.methods.agent.session.new, {
          cwd: rootA,
          mcpServers: [{
            name: "fixture",
            command: process.execPath,
            args: [fixture],
            env: [
              { name: "IMPULSE_MCP_EXIT_FILE", value: exitFile },
              { name: "IMPULSE_MCP_MARKER_FILE", value: markerFile },
            ],
          }],
        });
        const other = await connection.agent.request(acp.methods.agent.session.new, {
          cwd: rootB,
          mcpServers: [],
        });
        expect(updates.some((entry) =>
          entry.update.sessionUpdate === "available_commands_update"
        )).toBe(false);
        await expect(connection.agent.request(acp.methods.agent.session.prompt, {
          sessionId: owner.sessionId,
          prompt: [{ type: "text", text: "mcp misleading" }],
        })).rejects.toThrow();
        await expect(readFile(markerFile, "utf8")).rejects.toThrow();

        await connection.agent.request(acp.methods.agent.session.setMode, {
          sessionId: owner.sessionId,
          modeId: "AGENT",
        });
        const misleadingResult = await connection.agent.request(acp.methods.agent.session.prompt, {
          sessionId: owner.sessionId,
          prompt: [{ type: "text", text: "mcp misleading" }],
        });
        expect(misleadingResult.stopReason).toBe("end_turn");
        expect(await readFile(markerFile, "utf8")).toContain("mutated:");
        const result = await connection.agent.request(acp.methods.agent.session.prompt, {
          sessionId: owner.sessionId,
          prompt: [{ type: "text", text: `mcp echo ${allowAll ? "allow-all" : "prompt"}` }],
        });
        expect(result.stopReason).toBe("end_turn");
        const ownerToolUpdates = updates.filter((entry) =>
          entry.sessionId === owner.sessionId &&
          (entry.update.sessionUpdate === "tool_call" || entry.update.sessionUpdate === "tool_call_update") &&
          "name" in entry.update ? entry.update.name?.includes("session_echo") : true
        );
        expect(ownerToolUpdates.some((entry) => entry.update.sessionUpdate === "tool_call")).toBe(true);
        expect(updates.some((entry) =>
          entry.sessionId === owner.sessionId &&
          entry.update.sessionUpdate === "tool_call_update" &&
          JSON.stringify(entry.update).includes("mcp-echo:")
        )).toBe(true);
        expect(updates.some((entry) =>
          entry.sessionId === other.sessionId && JSON.stringify(entry.update).includes("session_echo")
        )).toBe(false);
        expect(permissionSessions).toEqual(allowAll ? [] : [owner.sessionId, owner.sessionId]);
        await expect(connection.agent.request(acp.methods.agent.session.prompt, {
          sessionId: other.sessionId,
          prompt: [{ type: "text", text: "mcp echo forbidden-cross-session" }],
        })).rejects.toThrow();

        await connection.agent.request(acp.methods.agent.session.close, { sessionId: owner.sessionId });
        let closed = false;
        for (let attempt = 0; attempt < 50; attempt++) {
          try {
            closed = (await readFile(exitFile, "utf8")).includes("closed:");
            if (closed) break;
          } catch {}
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(closed).toBe(true);
        await connection.agent.request(acp.methods.agent.session.close, { sessionId: other.sessionId });
      } finally {
        connection.close();
        child.stdin.end();
      }

      const exitCode = await new Promise<number | null>((resolve, reject) => {
        const timeout = setTimeout(() => {
          child.kill();
          reject(new Error("ACP MCP fixture did not exit after stdin EOF"));
        }, 5_000);
        child.once("exit", (code) => {
          clearTimeout(timeout);
          resolve(code);
        });
      });
      const stdout = await rawStdoutPromise;
      const stderr = await rawStderrPromise;
      expect(exitCode).toBe(0);
      for (const line of stdout.trim().split("\n").filter(Boolean)) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
      expect(stderr).not.toContain("runtime disposal failed");
    }
  }, 30_000);

  test("serves pure NDJSON and disposes cleanly over the official SDK", async () => {
    const rootA = await realpath(await mkdtemp(join(tmpdir(), "impulse-stdio-a-")));
    const rootB = await realpath(await mkdtemp(join(tmpdir(), "impulse-stdio-b-")));
    const child = spawn(process.execPath, [acpEntry, "--acp", "--allow-all"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        IMPULSE_ACP_TEST_DRIVER: "scripted",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const webStdout = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
    const [protocolOutput, auditOutput] = webStdout.tee();
    const rawStdoutPromise = new Response(auditOutput).text();
    const rawStderrPromise = new Response(
      Readable.toWeb(child.stderr) as ReadableStream<Uint8Array>
    ).text();
    const updates: acp.SessionNotification[] = [];
    const clientApp = acp
      .client({ name: "stdio-fixture" })
      .onRequest(acp.methods.client.session.requestPermission, () => {
        throw new Error("--allow-all should bypass permission requests");
      })
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        updates.push(params);
      });
    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      protocolOutput
    );
    const connection = clientApp.connect(stream);
    try {
      const initialized = await connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      expect(initialized.agentInfo?.name).toBe("impulse");
      const [a, b] = await Promise.all([
        connection.agent.request(acp.methods.agent.session.new, { cwd: rootA, mcpServers: [] }),
        connection.agent.request(acp.methods.agent.session.new, { cwd: rootB, mcpServers: [] }),
      ]);
      expect(a.configOptions?.find((option) => option.id === "approvalPolicy")).toMatchObject({
        currentValue: "allow-all",
      });
      await connection.agent.request(acp.methods.agent.session.setMode, {
        sessionId: a.sessionId,
        modeId: "AGENT",
      });
      const [resultA, resultB] = await Promise.all([
        connection.agent.request(acp.methods.agent.session.prompt, {
          sessionId: a.sessionId,
          prompt: [{ type: "text", text: "stream alpha" }],
        }),
        connection.agent.request(acp.methods.agent.session.prompt, {
          sessionId: b.sessionId,
          prompt: [{ type: "text", text: "stream beta" }],
        }),
      ]);
      expect(resultA.stopReason).toBe("end_turn");
      expect(resultB.stopReason).toBe("end_turn");
      for (const sessionId of [a.sessionId, b.sessionId]) {
        const kinds = updates
          .filter((update) => update.sessionId === sessionId)
          .map((update) => update.update.sessionUpdate);
        expect(kinds).toContain("agent_message_chunk");
        expect(kinds).toContain("agent_thought_chunk");
        expect(kinds).toContain("tool_call");
        expect(kinds).toContain("tool_call_update");
        expect(kinds).toContain("plan");
        expect(kinds).toContain("usage_update");
      }
      await connection.agent.request(acp.methods.agent.session.close, { sessionId: a.sessionId });
      await connection.agent.request(acp.methods.agent.session.close, { sessionId: b.sessionId });
    } finally {
      connection.close();
      child.stdin.end();
    }

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("ACP child did not exit after stdin EOF"));
      }, 5_000);
      child.once("exit", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });
    const stdout = await rawStdoutPromise;
    const stderr = await rawStderrPromise;
    expect(exitCode).toBe(0);
    expect(stdout.trim().length).toBeGreaterThan(0);
    for (const line of stdout.trim().split("\n")) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    expect(stdout).not.toContain("impulse v");
    expect(stdout).not.toContain("Provider-flexible");
    expect(stderr).not.toContain("Error:");
  }, 15_000);

  test("SDK handles malformed input without crashing or corrupting stdout", async () => {
    const child = spawn(process.execPath, [acpEntry, "--acp"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        IMPULSE_ACP_TEST_DRIVER: "scripted",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.write("{not-json}\n");
    child.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>).text(),
      new Response(Readable.toWeb(child.stderr) as ReadableStream<Uint8Array>).text(),
      new Promise<number | null>((resolve) => child.once("exit", resolve)),
    ]);
    expect(exitCode).toBe(0);
    const messages = stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    for (const message of messages) {
      expect(message).toMatchObject({ jsonrpc: "2.0" });
    }
    if (messages.length > 0) {
      expect(messages[0]).toMatchObject({ id: null, error: { code: -32700 } });
    }
    expect(stderr).toContain("Failed to parse JSON message");
  }, 10_000);

  test("exits non-zero when runtime disposal cannot complete", async () => {
    const child = spawn(process.execPath, [acpEntry, "--acp"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        IMPULSE_ACP_TEST_DRIVER: "scripted",
        IMPULSE_ACP_TEST_DISPOSE_FAILURE: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>).text(),
      new Response(Readable.toWeb(child.stderr) as ReadableStream<Uint8Array>).text(),
      new Promise<number | null>((resolve) => child.once("exit", resolve)),
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("injected runtime disposal failure");
    for (const line of stdout.trim().split("\n").filter(Boolean)) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  }, 10_000);
});
