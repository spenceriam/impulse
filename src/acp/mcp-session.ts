import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import * as acp from "@agentclientprotocol/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolDefinition } from "../api/types.js";
import type {
  RuntimeMode,
  RuntimeSessionToolDescriptor,
  RuntimeSessionToolProvider,
  RuntimeSessionToolResult,
  RuntimeToolKind,
} from "../runtime/types.js";
import type { RuntimeSessionResource } from "../runtime/session.js";

interface ConnectedMcpServer {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  closed: boolean;
}

interface ConnectedMcpTool {
  alias: string;
  originalName: string;
  server: ConnectedMcpServer;
  definition: ToolDefinition;
  descriptor: RuntimeSessionToolDescriptor;
}

export class UnsupportedAcpMcpTransportError extends Error {
  constructor(readonly serverName: string, readonly transport: string) {
    super(`MCP server '${serverName}' uses unsupported ${transport} transport; impulse ACP supports stable-v1 stdio MCP only.`);
    this.name = "UnsupportedAcpMcpTransportError";
  }
}

export interface AcpMcpSessionOptions {
  cwd: string;
  version: string;
  diagnostics?: (message: string) => void;
}

export class AcpMcpSession implements RuntimeSessionToolProvider, RuntimeSessionResource {
  readonly id = "acp-stdio-mcp";
  private readonly tools = new Map<string, ConnectedMcpTool>();

  private constructor(
    private readonly servers: ConnectedMcpServer[],
    tools: ConnectedMcpTool[]
  ) {
    for (const tool of tools) this.tools.set(tool.alias, tool);
  }

  static async connect(
    configs: acp.McpServer[],
    options: AcpMcpSessionOptions
  ): Promise<AcpMcpSession | undefined> {
    if (configs.length === 0) return undefined;
    for (const config of configs) {
      if ("type" in config) {
        throw new UnsupportedAcpMcpTransportError(config.name, String(config.type));
      }
      if (!isAbsolute(config.command)) {
        throw new Error(`MCP stdio command for '${config.name}' must be an absolute path.`);
      }
    }

    const diagnostics = options.diagnostics ?? (() => {});
    const servers: ConnectedMcpServer[] = [];
    const tools: ConnectedMcpTool[] = [];
    try {
      for (const config of configs) {
        if ("type" in config) continue;
        const env: Record<string, string> = {};
        for (const variable of config.env) {
          if (variable.name in env) {
            throw new Error(`MCP server '${config.name}' repeats environment variable ${variable.name}.`);
          }
          env[variable.name] = variable.value;
        }
        const transport = new StdioClientTransport({
          command: config.command,
          args: config.args,
          env,
          cwd: options.cwd,
          stderr: "pipe",
        });
        transport.stderr?.on("data", (chunk: Buffer | string) => {
          const message = chunk.toString().trim();
          if (message) diagnostics(`MCP ${config.name}: ${message}`);
        });
        const client = new Client({ name: "impulse", version: options.version });
        const connected: ConnectedMcpServer = {
          name: config.name,
          client,
          transport,
          closed: false,
        };
        try {
          await client.connect(transport);
          const listed = await client.listTools();
          servers.push(connected);
          for (const tool of listed.tools) {
            const alias = toolAlias(config.name, tool.name);
            if (tools.some((candidate) => candidate.alias === alias)) {
              throw new Error(`MCP tool alias collision: ${alias}`);
            }
            // MCP annotations are supplied by the external server. They may
            // improve presentation, but they cannot grant ASK authority or
            // bypass Impulse permission policy.
            const readOnly = false;
            const kind: RuntimeToolKind = "execute";
            tools.push({
              alias,
              originalName: tool.name,
              server: connected,
              definition: {
                type: "function",
                function: {
                  name: alias,
                  description: `[MCP ${config.name}] ${tool.description ?? tool.title ?? tool.name}`,
                  parameters: tool.inputSchema as Record<string, unknown>,
                },
              },
              descriptor: {
                name: alias,
                title: tool.title ?? tool.annotations?.title ?? tool.name,
                kind,
                readOnly,
                serverName: config.name,
                originalName: tool.name,
              },
            });
          }
        } catch (error) {
          await client.close().catch(() => transport.close().catch(() => undefined));
          throw error;
        }
      }
      return new AcpMcpSession(servers, tools);
    } catch (error) {
      await Promise.all(servers.map(async (server) => {
        await server.client.close().catch(() => server.transport.close().catch(() => undefined));
      }));
      throw error;
    }
  }

  definitions(mode: RuntimeMode): ToolDefinition[] {
    return [...this.tools.values()]
      .filter((tool) => mode === "AGENT" || tool.descriptor.readOnly)
      .map((tool) => tool.definition);
  }

  descriptor(name: string): RuntimeSessionToolDescriptor | undefined {
    const descriptor = this.tools.get(name)?.descriptor;
    return descriptor ? { ...descriptor } : undefined;
  }

  async execute(
    name: string,
    input: unknown,
    options: { signal?: AbortSignal } = {}
  ): Promise<RuntimeSessionToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { success: false, output: `Session MCP tool not found: ${name}` };
    if (tool.server.closed) return { success: false, output: `MCP server '${tool.server.name}' is closed.` };
    const args = input && typeof input === "object" && !Array.isArray(input)
      ? input as Record<string, unknown>
      : {};
    try {
      const result = await tool.server.client.callTool(
        { name: tool.originalName, arguments: args },
        undefined,
        options.signal ? { signal: options.signal } : undefined
      );
      const output = formatMcpResult(result);
      return {
        success: !("isError" in result && result.isError === true),
        output,
        metadata: {
          source: "mcp",
          server: tool.server.name,
          tool: tool.originalName,
          rawOutput: result,
        },
      };
    } catch (error) {
      return {
        success: false,
        output: error instanceof Error ? error.message : String(error),
        metadata: { source: "mcp", server: tool.server.name, tool: tool.originalName },
      };
    }
  }

  async close(): Promise<void> {
    const failures: Error[] = [];
    for (const server of this.servers) {
      if (server.closed) continue;
      try {
        await server.client.close();
        server.closed = true;
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Failed to close ACP MCP servers: ${failures.map((failure) => failure.message).join("; ")}`
      );
    }
  }
}

function toolAlias(serverName: string, toolName: string): string {
  const safeServer = safeName(serverName);
  const safeTool = safeName(toolName);
  const hash = createHash("sha256").update(`${serverName}\0${toolName}`).digest("hex").slice(0, 8);
  const prefix = `mcp_${safeServer}_`;
  const maxToolLength = Math.max(1, 64 - prefix.length - hash.length - 1);
  return `${prefix}${safeTool.slice(0, maxToolLength)}_${hash}`;
}

function safeName(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^_+|_+$/g, "");
  return safe || "unnamed";
}

function formatMcpResult(result: Awaited<ReturnType<Client["callTool"]>>): string {
  if (!("content" in result) || !Array.isArray(result.content)) {
    return "toolResult" in result ? JSON.stringify(result.toolResult) : "MCP tool completed.";
  }
  const content = result.content as CallToolResult["content"];
  const parts = content.map((part) => {
    if (part.type === "text") return part.text;
    if (part.type === "image") return `[Image: ${part.mimeType}]`;
    if (part.type === "audio") return `[Audio: ${part.mimeType}]`;
    if (part.type === "resource_link") return `[Resource: ${part.name} ${part.uri}]`;
    const resource = part.resource;
    return "text" in resource ? resource.text : `[Resource: ${resource.uri}]`;
  });
  if (parts.length > 0) return parts.join("\n");
  return result.structuredContent ? JSON.stringify(result.structuredContent) : "MCP tool completed.";
}
