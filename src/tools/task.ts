import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { GLMClient } from "../api/client";
import { getSubagentPrompt, getSubagentTools } from "../agent/prompts";
import type { ChatMessage, ToolDefinition } from "../api/types";
import { getCurrentMode } from "./mode-state";

const DESCRIPTION = `Launch a subagent for delegated work.

Required: prompt, description, subagent_type. Optional: thoroughness (explore only).
See docs/tools/task.md for guidance and examples.`;

const TaskSchema = z.object({
  prompt: z.string(),
  description: z.string(),
  subagent_type: z.enum(["explore", "general"]),
  thoroughness: z.enum(["quick", "medium", "thorough"]).optional(),
});

type TaskInput = z.infer<typeof TaskSchema>;
type Thoroughness = "quick" | "medium" | "thorough";

// Maximum iterations to prevent infinite loops
const MAX_ITERATIONS = 50;

/**
 * Get thoroughness instructions for explore subagent
 */
function getThoroughnessInstructions(level: Thoroughness): string {
  switch (level) {
    case "quick":
      return `
THOROUGHNESS: QUICK
- Do 1-2 targeted searches maximum
- Return first relevant findings
- Don't explore tangential paths
- Prioritize speed over completeness`;
    case "medium":
      return `
THOROUGHNESS: MEDIUM (default)
- Do 3-5 searches as needed
- Follow up on promising leads
- Cover main patterns but don't exhaustively search
- Balance speed and completeness`;
    case "thorough":
      return `
THOROUGHNESS: THOROUGH
- Do comprehensive search across the codebase
- Check multiple directories and naming conventions
- Follow all relevant paths
- Ensure nothing is missed
- Take time to be complete`;
    default:
      return "";
  }
}

/**
 * Execute a subagent with its own conversation loop
 * Returns the final response or aggregated tool results
 */
async function executeSubagent(
  type: "explore" | "general",
  prompt: string,
  _description: string,  // Kept for potential future logging
  thoroughness?: Thoroughness
): Promise<{ success: boolean; output: string; summary: string[] }> {
  let systemPrompt = getSubagentPrompt(type);
  
  // Add thoroughness instructions for explore subagent
  if (type === "explore" && thoroughness) {
    systemPrompt += getThoroughnessInstructions(thoroughness);
  }
  
  const allowedToolNames = getSubagentTools(type);
  
  // Get tool definitions for allowed tools only
  const allTools = Tool.getAPIDefinitions();
  const filteredTools: ToolDefinition[] = allTools.filter(
    (t) => allowedToolNames.includes(t.function.name)
  );
  
  // Build initial messages
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];
  
  // Summary of actions taken (for display)
  const actionSummary: string[] = [];
  
  // Conversation loop
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // Make non-streaming completion (subagents work in batch mode)
    // Only include tools if we have any (undefined vs empty array matters)
    const completionOptions: Parameters<typeof GLMClient.complete>[0] = {
      model: "glm-4.7-flash", // Use fast flagship model for subagents
      messages,
    };
    
    if (filteredTools.length > 0) {
      completionOptions.tools = filteredTools;
    }
    
    const response = await GLMClient.complete(completionOptions);
    
    const choice = response.choices[0];
    if (!choice) {
      return { success: false, output: "No response from model", summary: actionSummary };
    }
    
    const assistantMessage = choice.message;
    
    // Add assistant message to conversation
    // Extract text content (handle both string and content array types)
    const assistantContent = typeof assistantMessage.content === "string" 
      ? assistantMessage.content 
      : assistantMessage.content === null 
        ? ""
        : JSON.stringify(assistantMessage.content);
    
    messages.push({
      role: "assistant",
      content: assistantContent,
      tool_calls: assistantMessage.tool_calls,
    });
    
    // If no tool calls, we're done
    if (choice.finish_reason !== "tool_calls" || !assistantMessage.tool_calls?.length) {
      // Extract text content (handle both string and content array types)
      const contentText = typeof assistantMessage.content === "string" 
        ? assistantMessage.content 
        : assistantMessage.content === null 
          ? ""
          : JSON.stringify(assistantMessage.content);
      
      return {
        success: true,
        output: contentText,
        summary: actionSummary,
      };
    }
    
    // Execute tool calls
    const toolResults: Array<{ tool_call_id: string; content: string }> = [];
    
    for (const toolCall of assistantMessage.tool_calls) {
      const toolName = toolCall.function.name;
      
      // Security check: only execute allowed tools
      if (!allowedToolNames.includes(toolName)) {
        toolResults.push({
          tool_call_id: toolCall.id,
          content: `Error: Tool "${toolName}" is not allowed for ${type} subagent`,
        });
        continue;
      }
      
      try {
        // Parse arguments
        const args = JSON.parse(toolCall.function.arguments || "{}");
        
        // Execute tool
        const result = await Tool.execute(toolName, args);
        
        // Add to summary
        const argSummary = extractArgSummary(args);
        actionSummary.push(`${toolName}${argSummary ? ` ${argSummary}` : ""}`);
        
        toolResults.push({
          tool_call_id: toolCall.id,
          content: result.success 
            ? result.output 
            : `Error: ${result.output}`,
        });
      } catch (error) {
        toolResults.push({
          tool_call_id: toolCall.id,
          content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    
    // Add tool results to conversation
    for (const result of toolResults) {
      messages.push({
        role: "tool",
        content: result.content,
        tool_call_id: result.tool_call_id,
      });
    }
  }
  
  // Max iterations reached
  return {
    success: false,
    output: "Subagent reached maximum iterations without completing",
    summary: actionSummary,
  };
}

/**
 * Extract a brief summary from tool arguments for display
 */
function extractArgSummary(args: Record<string, unknown>): string {
  const keys = ["path", "filePath", "file", "command", "pattern", "query"];
  for (const key of keys) {
    if (args[key]) {
      const val = String(args[key]);
      return val.length > 30 ? val.slice(0, 27) + "..." : val;
    }
  }
  return "";
}

export const taskTool: Tool<TaskInput> = Tool.define(
  "task",
  DESCRIPTION,
  TaskSchema,
  async (input: TaskInput): Promise<ToolResult> => {
    try {
      const currentMode = getCurrentMode();
      if ((currentMode === "PLANNER" || currentMode === "PLAN-PRD") && input.subagent_type !== "explore") {
        return {
          success: false,
          output: `${currentMode} mode only allows explore subagents. Use subagent_type="explore" for research-only delegation.`,
        };
      }

      const result = await executeSubagent(
        input.subagent_type,
        input.prompt,
        input.description,
        input.thoroughness
      );
      
      // Format output with summary
      let output = result.output;
      
      // Add action summary if there were tool calls
      if (result.summary.length > 0) {
        const summaryText = result.summary
          .map((s) => `  - ${s}`)
          .join("\n");
        output = `Actions taken:\n${summaryText}\n\nResult:\n${output}`;
      }

      return {
        success: result.success,
        output,
        metadata: {
          type: "task",
          subagentType: input.subagent_type,
          description: input.description,
          toolCallCount: result.summary.length,
          actions: result.summary,
        },
      };
    } catch (error) {
      if (error instanceof Error) {
        return {
          success: false,
          output: `Subagent error: ${error.message}`,
        };
      }

      return {
        success: false,
        output: String(error),
      };
    }
  }
);
