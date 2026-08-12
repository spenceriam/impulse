import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { createImpulseAcpAgent } from "./adapter.js";
import { HeadlessRuntime, type RuntimeTurnDriver } from "../runtime/session.js";
import { AgentLoopTurnDriver } from "../runtime/agent-loop-driver.js";

export interface AcpStdioServerOptions {
  version: string;
  allowAll?: boolean;
  turnDriver?: RuntimeTurnDriver;
  diagnostics?: (message: string) => void;
}

export async function serveAcpStdio(options: AcpStdioServerOptions): Promise<void> {
  const diagnostics = options.diagnostics ?? ((message: string) => {
    process.stderr.write(`[impulse-acp] ${message}\n`);
  });
  const runtime = new HeadlessRuntime({
    turnDriver: options.turnDriver ?? new AgentLoopTurnDriver(),
    ...(options.allowAll ? { launchApprovalPolicy: "allow-all" } : {}),
  });
  const app = createImpulseAcpAgent({
    runtime,
    version: options.version,
    diagnostics,
  });
  const stream = acp.ndJsonStream(
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>
  );
  const connection = app.connect(stream);
  let connectionFailure: Error | undefined;
  try {
    await connection.closed;
  } catch (error) {
    connectionFailure = error instanceof Error ? error : new Error(String(error));
  }

  let disposalFailure: Error | undefined;
  try {
    await runtime.dispose();
  } catch (error) {
    disposalFailure = error instanceof Error ? error : new Error(String(error));
    diagnostics(`runtime disposal failed: ${disposalFailure.message}`);
  }

  if (connectionFailure && disposalFailure) {
    throw new AggregateError(
      [connectionFailure, disposalFailure],
      `ACP connection and runtime disposal failed: ${connectionFailure.message}; ${disposalFailure.message}`
    );
  }
  if (connectionFailure) throw connectionFailure;
  if (disposalFailure) throw disposalFailure;
}
