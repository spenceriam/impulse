/**
 * System Prompt Generator
 * 
 * Generates mode-aware system prompts for the GLM agent.
 * Key design: MCP tool descriptions stay OUT of context until
 * the agent explicitly searches for them.
 */

import { MODES } from "../constants";

type Mode = typeof MODES[number];

/**
 * MCP tool discovery instructions for execution modes
 * 
 * Uses the mcp_discover tool to find available MCP tools on-demand,
 * keeping the context window lean until tools are actually needed.
 */
const MCP_DISCOVERY_FULL = `
## External Capabilities via MCP

You have access to external tools via MCP servers. Use the \`mcp_discover\` tool to find what's available.

### Discovery Workflow

1. **List available servers**: \`mcp_discover(action: "list")\`

2. **Search for tools** by capability:
   \`mcp_discover(action: "search", query: "web search")\`

3. **Get tool details** before using:
   \`mcp_discover(action: "details", server: "<server>", tool: "<tool>")\`

Always discover first - never guess tool names or parameters.
`;

/**
 * MCP awareness for research/planning modes (lighter touch)
 */
const MCP_AWARENESS_RESEARCH = `
## External Research Tools

MCP tools are available for research. Use \`mcp_discover(action: "list")\` to see available servers and tools.
`;

/**
 * Base system prompt (applies to all modes)
 */
const BASE_PROMPT = `You are GLM-CLI, an AI coding assistant.

IMPORTANT: Always respond in English regardless of the input language. All responses, explanations, comments, and documentation must be in English.

You help developers with software engineering tasks including:
- Writing and editing code
- Debugging and fixing issues
- Explaining code and concepts
- Planning and architecture
- Documentation

Be concise, accurate, and practical. Prefer showing code over lengthy explanations.

## Session Header

Use the set_header tool to set a descriptive title for the current conversation. This appears at the top of the session screen.

Guidelines:
- Set when you understand the user's task (not before)
- Update at meaningful milestones (phase changes, focus shifts)
- Do NOT update constantly - only when context meaningfully changes
- Keep titles concise (max 50 characters)
- Let the description naturally indicate the action

Good examples:
- "Express mode permission system"
- "Fixing streaming display issue"
- "Chat session"

Call set_header once you understand what the user needs.`;

/**
 * Mode-specific additions
 */
const MODE_ADDITIONS: Record<Mode, string> = {
  AUTO: `
## Mode: AUTO
You decide the best approach based on the user's request. You may switch between execution and planning as needed.
`,
  AGENT: `
## Mode: AGENT
Full execution mode. You can read, write, and modify files. Use tools to accomplish tasks. Be thorough but efficient.
`,
  PLANNER: `
## Mode: PLANNER
Research and documentation mode. Focus on understanding the codebase, gathering requirements, and creating documentation. Read-only access to files.
`,
  "PLAN-PRD": `
## Mode: PLAN-PRD
Quick PRD creation through Q&A. Ask clarifying questions to understand requirements, then produce a concise Product Requirements Document.
`,
  DEBUG: `
## Mode: DEBUG
Systematic debugging mode. Follow the 7-step debugging process:
1. Reproduce the issue
2. Gather information
3. Form hypothesis
4. Test hypothesis
5. Implement fix
6. Verify fix
7. Document resolution
`,
};

/**
 * Generate a system prompt for the given mode
 */
export function generateSystemPrompt(mode: Mode): string {
  const parts: string[] = [BASE_PROMPT];
  
  // Add mode-specific content
  const modeAddition = MODE_ADDITIONS[mode];
  if (modeAddition) {
    parts.push(modeAddition);
  }
  
  // Add MCP instructions based on mode
  if (mode === "AGENT" || mode === "DEBUG" || mode === "AUTO") {
    // Full discovery workflow for execution modes
    parts.push(MCP_DISCOVERY_FULL);
  } else if (mode === "PLANNER" || mode === "PLAN-PRD") {
    // Light awareness for research modes
    parts.push(MCP_AWARENESS_RESEARCH);
  }
  
  return parts.join("\n").trim();
}

/**
 * Get just the MCP discovery instructions (for appending to existing prompts)
 */
export function getMCPInstructions(mode: Mode): string {
  if (mode === "AGENT" || mode === "DEBUG" || mode === "AUTO") {
    return MCP_DISCOVERY_FULL.trim();
  } else if (mode === "PLANNER" || mode === "PLAN-PRD") {
    return MCP_AWARENESS_RESEARCH.trim();
  }
  return "";
}
