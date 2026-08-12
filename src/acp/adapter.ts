import * as acp from "@agentclientprotocol/sdk";
import type {
  RuntimeConfig,
  RuntimeConfigKey,
  RuntimeEvent,
  RuntimeMode,
  RuntimePrompt,
  RuntimeStopReason,
  RuntimeToolKind,
} from "../runtime/types.js";
import type { HeadlessRuntime, RuntimeSession } from "../runtime/session.js";
import {
  AcpMcpSession,
  UnsupportedAcpMcpTransportError,
} from "./mcp-session.js";

export interface ImpulseAcpAgentOptions {
  runtime: HeadlessRuntime;
  version: string;
  diagnostics?: (message: string) => void;
}

const MODES: acp.SessionModeState["availableModes"] = [
  { id: "ASK", name: "ASK", description: "Read-only analysis and guidance" },
  { id: "AGENT", name: "AGENT", description: "Execute tools within the active execution boundary" },
];

function selectOption(
  id: string,
  name: string,
  currentValue: string,
  values: readonly string[],
  category: string
): acp.SessionConfigOption {
  return {
    type: "select",
    id,
    name,
    category,
    currentValue,
    options: values.map((value) => ({ value, name: value })),
  };
}

export function acpConfigOptions(config: RuntimeConfig): acp.SessionConfigOption[] {
  const options: acp.SessionConfigOption[] = [
    selectOption("density", "Density", config.density, ["compact", "comfy"], "_presentation"),
    selectOption("thinkingDisplay", "Thinking", config.thinkingDisplay, ["off", "summary", "full"], "thought_level"),
    selectOption("reasoningLevel", "Reasoning", config.reasoningLevel, ["off", "low", "medium", "high"], "thought_level"),
    selectOption("communicationStyle", "Communication", config.communicationStyle, ["concise", "balanced", "detailed"], "_communication"),
    selectOption("approvalPolicy", "Approvals", config.approvalPolicy, ["prompt", "allow-all"], "_approval"),
  ];
  if (config.workerModel) {
    options.push(selectOption("workerModel", "Worker model", config.workerModel, [config.workerModel], "model"));
  }
  if (config.subagentModel) {
    options.push(selectOption("subagentModel", "Subagent model", config.subagentModel, [config.subagentModel], "model"));
  }
  return options;
}

function modeState(mode: RuntimeMode): acp.SessionModeState {
  return { currentModeId: mode, availableModes: MODES };
}

function getSession(runtime: HeadlessRuntime, id: string): RuntimeSession {
  const session = runtime.getSession(id);
  if (!session) throw new acp.RequestError(-32001, `Unknown or closed session: ${id}`);
  return session;
}

function extractPrompt(blocks: acp.ContentBlock[]): RuntimePrompt {
  const content: RuntimePrompt["content"] = [];
  const text: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        content.push({ type: "text", text: block.text });
        text.push(block.text);
        break;
      case "image":
        content.push({
          type: "image",
          data: block.data,
          mimeType: block.mimeType,
          ...(block.uri ? { uri: block.uri } : {}),
        });
        text.push(block.uri ? `[Image: ${block.uri}]` : `[Image: ${block.mimeType}]`);
        break;
      case "resource_link":
        content.push({
          type: "resource",
          uri: block.uri,
          ...(block.mimeType ? { mimeType: block.mimeType } : {}),
        });
        text.push(`[Resource: ${block.name} ${block.uri}]`);
        break;
      case "resource": {
        const resource = block.resource;
        const resourceText = "text" in resource ? resource.text : undefined;
        content.push({
          type: "resource",
          uri: resource.uri,
          ...(resourceText === undefined ? {} : { text: resourceText }),
          ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
        });
        text.push(resourceText ?? `[Resource: ${resource.uri}]`);
        break;
      }
      case "audio":
        throw new acp.RequestError(-32602, "Audio prompts are not supported by impulse.");
    }
  }
  return { text: text.join("\n"), content };
}

function mapStopReason(reason: RuntimeStopReason): acp.StopReason {
  switch (reason) {
    case "end-turn": return "end_turn";
    case "max-tokens": return "max_tokens";
    case "refusal": return "refusal";
    case "cancelled": return "cancelled";
    case "error": return "refusal";
  }
}

function mapToolKind(kind: RuntimeToolKind): acp.ToolKind {
  return kind === "switch-mode" ? "switch_mode" : kind;
}

function mapToolLocations(locations: Array<{ path: string; line?: number }>): acp.ToolCallLocation[] {
  return locations.map((location) => ({
    path: location.path,
    ...(location.line === undefined ? {} : { line: location.line }),
  }));
}

function mapPlanEntries(entries: Array<{ content: string; priority: "high" | "medium" | "low"; status: "pending" | "in-progress" | "completed" }>): acp.PlanEntry[] {
  return entries.map((entry) => ({
    content: entry.content,
    priority: entry.priority,
    status: entry.status === "in-progress" ? "in_progress" : entry.status,
  }));
}

function configValue(
  session: RuntimeSession,
  configId: string,
  value: string | boolean
): void {
  if (typeof value === "boolean") {
    throw new acp.RequestError(-32602, `Configuration ${configId} does not accept a boolean value.`);
  }
  const allowed: Partial<Record<RuntimeConfigKey, readonly string[]>> = {
    density: ["compact", "comfy"],
    thinkingDisplay: ["off", "summary", "full"],
    reasoningLevel: ["off", "low", "medium", "high"],
    communicationStyle: ["concise", "balanced", "detailed"],
    approvalPolicy: ["prompt", "allow-all"],
  };
  if (!(configId in allowed) && configId !== "workerModel" && configId !== "subagentModel") {
    throw new acp.RequestError(-32602, `Unknown session configuration: ${configId}`);
  }
  const key = configId as RuntimeConfigKey;
  const values = allowed[key];
  if (values && !values.includes(value)) {
    throw new acp.RequestError(-32602, `Invalid value '${value}' for ${configId}.`);
  }
  session.setConfig(key, value as never);
}

function permissionOptions(options: Array<{ id: string; label: string; kind: "allow-once" | "allow-always" | "reject-once" | "reject-always" }>): acp.PermissionOption[] {
  return options.map((option) => ({
    optionId: option.id,
    name: option.label,
    kind: option.kind.replace("-", "_") as acp.PermissionOptionKind,
  }));
}

export function createImpulseAcpAgent(options: ImpulseAcpAgentOptions): acp.AgentApp {
  let clientCapabilities: acp.ClientCapabilities = {};
  const diagnostics = options.diagnostics ?? (() => {});

  return acp
    .agent({ name: "impulse" })
    .onRequest(acp.methods.agent.initialize, ({ params }) => {
      clientCapabilities = params.clientCapabilities ?? {};
      return {
        protocolVersion: acp.PROTOCOL_VERSION,
        agentInfo: { name: "impulse", version: options.version },
        agentCapabilities: {
          loadSession: false,
          promptCapabilities: { image: true, embeddedContext: true },
          sessionCapabilities: {
            additionalDirectories: {},
            close: {},
          },
        },
      };
    })
    .onRequest(acp.methods.agent.session.new, async ({ params, client }) => {
      let mcpSession: AcpMcpSession | undefined;
      try {
        mcpSession = await AcpMcpSession.connect(params.mcpServers, {
          cwd: params.cwd,
          version: options.version,
          diagnostics,
        });
      } catch (error) {
        if (error instanceof UnsupportedAcpMcpTransportError) {
          throw new acp.RequestError(-32602, error.message);
        }
        throw new acp.RequestError(
          -32002,
          `Failed to initialize ACP MCP servers: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      let session: RuntimeSession;
      try {
        session = options.runtime.createSession({
          cwd: params.cwd,
          ...(params.additionalDirectories ? { additionalRoots: params.additionalDirectories } : {}),
          ...(mcpSession ? { tools: mcpSession, resources: [mcpSession] } : {}),
        });
      } catch (error) {
        await mcpSession?.close().catch((cleanupError) => {
          diagnostics(`MCP rollback failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
        });
        throw error;
      }
      const snapshot = session.snapshot();
      await Promise.all([
        client.notify(acp.methods.client.session.update, {
          sessionId: session.id,
          update: { sessionUpdate: "current_mode_update", currentModeId: snapshot.mode },
        }),
        client.notify(acp.methods.client.session.update, {
          sessionId: session.id,
          update: { sessionUpdate: "config_option_update", configOptions: acpConfigOptions(snapshot.config) },
        }),
        client.notify(acp.methods.client.session.update, {
          sessionId: session.id,
          update: {
            sessionUpdate: "session_info_update",
            title: "Impulse session",
            updatedAt: new Date().toISOString(),
          },
        }),
      ]);
      return {
        sessionId: session.id,
        modes: modeState(snapshot.mode),
        configOptions: acpConfigOptions(snapshot.config),
      };
    })
    .onRequest(acp.methods.agent.session.setMode, async ({ params, client }) => {
      if (params.modeId !== "ASK" && params.modeId !== "AGENT") {
        throw new acp.RequestError(-32602, `Unknown mode: ${params.modeId}`);
      }
      const session = getSession(options.runtime, params.sessionId);
      const activeTurnOwnsUpdates = session.snapshot().turnActive;
      await session.transitionMode(params.modeId);
      if (!activeTurnOwnsUpdates) {
        await client.notify(acp.methods.client.session.update, {
          sessionId: session.id,
          update: { sessionUpdate: "current_mode_update", currentModeId: params.modeId },
        });
      }
      return {};
    })
    .onRequest(acp.methods.agent.session.setConfigOption, async ({ params, client }) => {
      const session = getSession(options.runtime, params.sessionId);
      configValue(session, params.configId, params.value);
      const configOptions = acpConfigOptions(session.snapshot().config);
      await client.notify(acp.methods.client.session.update, {
        sessionId: session.id,
        update: { sessionUpdate: "config_option_update", configOptions },
      });
      return { configOptions };
    })
    .onRequest(acp.methods.agent.session.prompt, async ({ params, client, signal }) => {
      const session = getSession(options.runtime, params.sessionId);
      const pending = new Set<Promise<void>>();
      const interactionAbort = new AbortController();
      const cancelForRequest = () => {
        interactionAbort.abort();
        void session.cancel();
      };
      signal.addEventListener("abort", cancelForRequest, { once: true });
      const track = (operation: Promise<void>): void => {
        pending.add(operation);
        void operation.finally(() => pending.delete(operation));
      };
      const notify = (update: acp.SessionUpdate): Promise<void> =>
        client.notify(acp.methods.client.session.update, { sessionId: session.id, update });

      const handleEvent = (event: RuntimeEvent): void => {
        switch (event.type) {
          case "assistant-token":
            track(notify({
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: event.text },
              ...(event.messageId ? { messageId: event.messageId } : {}),
            }));
            break;
          case "thinking-token":
            track(notify({
              sessionUpdate: "agent_thought_chunk",
              content: { type: "text", text: event.text },
              ...(event.messageId ? { messageId: event.messageId } : {}),
            }));
            break;
          case "tool-start":
            track(notify({
              sessionUpdate: "tool_call",
              toolCallId: event.id,
              title: event.title,
              name: event.name,
              kind: mapToolKind(event.kind),
              status: "in_progress",
              ...(event.locations ? { locations: mapToolLocations(event.locations) } : {}),
              ...(event.rawInput === undefined ? {} : { rawInput: event.rawInput }),
            }));
            break;
          case "tool-update":
            track(notify({
              sessionUpdate: "tool_call_update",
              toolCallId: event.id,
              ...(event.title === undefined ? {} : { title: event.title }),
              ...(event.status === undefined ? {} : { status: event.status === "in-progress" ? "in_progress" : event.status }),
              ...(event.locations ? { locations: mapToolLocations(event.locations) } : {}),
              ...(event.rawInput === undefined ? {} : { rawInput: event.rawInput }),
              ...(event.rawOutput === undefined ? {} : { rawOutput: event.rawOutput }),
              ...(event.output === undefined ? {} : { content: [{ type: "content", content: { type: "text", text: event.output } }] }),
            }));
            break;
          case "tool-end":
            track(notify({
              sessionUpdate: "tool_call_update",
              toolCallId: event.id,
              status: event.success ? "completed" : "failed",
              content: [{ type: "content", content: { type: "text", text: event.output } }],
              rawOutput: event.rawOutput ?? { success: event.success, output: event.output, durationMs: event.durationMs },
            }));
            break;
          case "permission-request":
            void (async () => {
              try {
                const response = await client.request(acp.methods.client.session.requestPermission, {
                  sessionId: session.id,
                  toolCall: {
                    toolCallId: event.request.toolCallId,
                    title: event.request.title,
                    kind: mapToolKind(event.request.kind),
                    status: "pending",
                    ...(event.request.locations ? { locations: mapToolLocations(event.request.locations) } : {}),
                    ...(event.request.rawInput === undefined ? {} : { rawInput: event.request.rawInput }),
                  },
                  options: permissionOptions(event.request.options),
                }, { cancellationSignal: interactionAbort.signal }) as acp.RequestPermissionResponse;
                session.respondPermission(event.request.id, response.outcome);
              } catch (error) {
                diagnostics(`permission request failed: ${error instanceof Error ? error.message : String(error)}`);
                session.respondPermission(event.request.id, { outcome: "cancelled" });
              }
            })();
            break;
          case "question":
            void (async () => {
              if (!clientCapabilities.elicitation?.form) {
                diagnostics("client does not advertise unstable form elicitation; question cancelled");
                session.respondQuestion(event.request.id, {
                  outcome: "cancelled",
                  reason: "ACP client does not advertise form elicitation.",
                });
                return;
              }
              try {
                const choices = event.request.choices ?? [];
                const response = await client.request(acp.methods.client.elicitation.create, {
                  mode: "form",
                  sessionId: session.id,
                  message: event.request.prompt,
                  requestedSchema: {
                    type: "object",
                    properties: {
                      answer: event.request.multiple
                        ? {
                            type: "array",
                            title: event.request.prompt,
                            items: { anyOf: choices.map((choice) => ({ const: choice.id, title: choice.label })) },
                          }
                        : {
                            type: "string",
                            title: event.request.prompt,
                            oneOf: choices.map((choice) => ({ const: choice.id, title: choice.label })),
                          },
                    },
                    required: ["answer"],
                  },
                }, { cancellationSignal: interactionAbort.signal }) as acp.CreateElicitationResponse;
                const acceptedContent = response.action === "accept"
                  ? response.content as Record<string, string | number | boolean | string[]> | null | undefined
                  : undefined;
                const answer = acceptedContent?.["answer"];
                const values = Array.isArray(answer)
                  ? answer.map(String)
                  : answer === undefined ? [] : [String(answer)];
                session.respondQuestion(event.request.id, response.action === "accept"
                  ? { outcome: "answered", values }
                  : { outcome: "cancelled", reason: `Elicitation ${response.action}.` });
              } catch (error) {
                diagnostics(`elicitation failed: ${error instanceof Error ? error.message : String(error)}`);
                session.respondQuestion(event.request.id, { outcome: "cancelled", reason: "Elicitation failed." });
              }
            })();
            break;
          case "plan":
            track(notify({ sessionUpdate: "plan", entries: mapPlanEntries(event.entries) }));
            break;
          case "plan-update":
            track(notify(clientCapabilities.plan
              ? {
                  sessionUpdate: "plan_update",
                  plan: { type: "items", planId: event.id, entries: mapPlanEntries(event.entries) },
                }
              : { sessionUpdate: "plan", entries: mapPlanEntries(event.entries) }));
            break;
          case "mode":
            track(notify({ sessionUpdate: "current_mode_update", currentModeId: event.mode }));
            break;
          case "config":
            track(notify({ sessionUpdate: "config_option_update", configOptions: acpConfigOptions(event.config) }));
            break;
          case "info":
            track(notify({
              sessionUpdate: "session_info_update",
              ...(event.title ? { title: event.title } : {}),
              updatedAt: event.updatedAt ?? new Date().toISOString(),
            }));
            break;
          case "usage":
            track(notify({
              sessionUpdate: "usage_update",
              used: event.usage.contextTokens,
              size: event.usage.contextWindow,
              ...(event.usage.costUsd === undefined
                ? {}
                : { cost: { amount: event.usage.costUsd, currency: "USD" } }),
            }));
            break;
          case "turn-start":
          case "permission-outcome":
          case "question-outcome":
          case "turn-end":
          case "turn-error":
            break;
          case "turn-cancel":
            interactionAbort.abort();
            break;
        }
      };
      const unsubscribe = session.onEvent(handleEvent);
      try {
        const result = await session.run(extractPrompt(params.prompt));
        while (pending.size > 0) await Promise.all([...pending]);
        return { stopReason: mapStopReason(result.stopReason) };
      } finally {
        signal.removeEventListener("abort", cancelForRequest);
        interactionAbort.abort();
        unsubscribe();
      }
    })
    .onNotification(acp.methods.agent.session.cancel, async ({ params }) => {
      await getSession(options.runtime, params.sessionId).cancel();
    })
    .onRequest(acp.methods.agent.session.close, async ({ params }) => {
      if (!await options.runtime.closeSession(params.sessionId)) {
        throw new acp.RequestError(-32001, `Unknown or closed session: ${params.sessionId}`);
      }
      return {};
    });
}
