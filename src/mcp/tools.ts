/**
 * MCP Tools Bridge
 * 
 * Registers MCP tools in the Tool registry so they can be called
 * by the AI through the standard tool execution flow.
 */

import { z } from "zod";
import { Tool } from "../tools/registry";
import { mcpManager } from "./manager";
import { MCPDiscovery } from "./discovery";
import type { MCPTool, MCPServerName } from "./types";

/**
 * Convert MCP tool input schema to Zod schema
 */
function mcpSchemaToZod(tool: MCPTool): z.ZodType<Record<string, unknown>> {
  const schema = tool.inputSchema;
  
  if (!schema.properties) {
    return z.object({});
  }

  const shape: Record<string, z.ZodTypeAny> = {};
  const required = schema.required || [];

  for (const [name, prop] of Object.entries(schema.properties)) {
    let fieldSchema: z.ZodTypeAny;

    switch (prop.type) {
      case "string":
        if (prop.enum) {
          fieldSchema = z.enum(prop.enum as [string, ...string[]]);
        } else {
          fieldSchema = z.string();
        }
        break;
      case "number":
        fieldSchema = z.number();
        break;
      case "boolean":
        fieldSchema = z.boolean();
        break;
      case "array":
        fieldSchema = z.array(z.unknown());
        break;
      case "object":
        fieldSchema = z.record(z.unknown());
        break;
      default:
        fieldSchema = z.unknown();
    }

    // Add description if present
    if (prop.description) {
      fieldSchema = fieldSchema.describe(prop.description);
    }

    // Make optional if not required
    if (!required.includes(name)) {
      fieldSchema = fieldSchema.optional();
    }

    shape[name] = fieldSchema;
  }

  return z.object(shape);
}

/**
 * Register a single MCP tool in the Tool registry
 */
function registerMCPTool(tool: MCPTool): void {
  const zodSchema = mcpSchemaToZod(tool);
  const serverName = tool.server as MCPServerName;

  Tool.define(
    tool.name,
    tool.description,
    zodSchema,
    async (input: Record<string, unknown>) => {
      // Call the MCP tool through the manager
      const result = await mcpManager.callTool(serverName, tool.name, input);
      
      return {
        success: result.success,
        output: result.output,
        metadata: {
          server: serverName,
          tool: tool.name,
        },
      };
    },
    { timeout: 60000 } // 60 second timeout for MCP tools
  );
}

/**
 * Register all MCP tools in the Tool registry
 * Call this after MCP manager is initialized
 */
export async function registerMCPTools(): Promise<void> {
  // Ensure MCP manager is initialized
  await mcpManager.ensureInitialized();

  // Get all tools from discovery
  const tools = await MCPDiscovery.getAllTools();

  // Register each tool
  for (const tool of tools) {
    try {
      registerMCPTool(tool);
    } catch (error) {
      console.error(`Failed to register MCP tool ${tool.name}:`, error);
    }
  }

  console.log(`Registered ${tools.length} MCP tools`);
}

/**
 * Get list of all registered MCP tool names
 */
export async function getMCPToolNames(): Promise<string[]> {
  const tools = await MCPDiscovery.getAllTools();
  return tools.map(t => t.name);
}
