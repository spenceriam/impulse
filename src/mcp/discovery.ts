/**
 * MCP Tool Discovery Service
 * 
 * Provides intelligent tool discovery across all MCP servers.
 * Caches tool metadata and provides search capabilities.
 * 
 * Key design: Tool descriptions stay OUT of context until explicitly
 * searched, keeping the context window lean.
 */

import { mcpManager } from "./manager";
import { 
  MCPTool, 
  MCPToolSearchResult, 
  MCPServerName,
} from "./types";

// Cache for tool metadata - persists across searches
let toolCache: MCPTool[] = [];
let cacheInitialized = false;
let cacheInitPromise: Promise<void> | null = null;

// Hardcoded tool definitions for Z.AI and Context7 servers
// (These servers have known, stable tool sets)
const KNOWN_TOOLS: Record<MCPServerName, MCPTool[]> = {
  "vision": [
    {
      name: "ui_to_artifact",
      description: "Convert UI screenshot to code artifact (HTML/CSS/React)",
      server: "vision",
      inputSchema: {
        type: "object",
        properties: {
          image: { type: "string", description: "Base64 encoded image or URL" },
          format: { type: "string", enum: ["html", "react", "vue"], description: "Output format" },
        },
        required: ["image"],
      },
    },
    {
      name: "extract_text_from_screenshot",
      description: "Extract text content from a screenshot using OCR",
      server: "vision",
      inputSchema: {
        type: "object",
        properties: {
          image: { type: "string", description: "Base64 encoded image or URL" },
        },
        required: ["image"],
      },
    },
    {
      name: "diagnose_error_screenshot",
      description: "Analyze screenshot of an error message and suggest fixes",
      server: "vision",
      inputSchema: {
        type: "object",
        properties: {
          image: { type: "string", description: "Base64 encoded image or URL" },
          context: { type: "string", description: "Additional context about the error" },
        },
        required: ["image"],
      },
    },
    {
      name: "understand_technical_diagram",
      description: "Analyze and explain a technical diagram (architecture, flowchart, etc.)",
      server: "vision",
      inputSchema: {
        type: "object",
        properties: {
          image: { type: "string", description: "Base64 encoded image or URL" },
        },
        required: ["image"],
      },
    },
    {
      name: "analyze_data_visualization",
      description: "Analyze charts, graphs, and data visualizations",
      server: "vision",
      inputSchema: {
        type: "object",
        properties: {
          image: { type: "string", description: "Base64 encoded image or URL" },
          question: { type: "string", description: "Specific question about the visualization" },
        },
        required: ["image"],
      },
    },
    {
      name: "ui_diff_check",
      description: "Compare two UI screenshots and identify differences",
      server: "vision",
      inputSchema: {
        type: "object",
        properties: {
          image1: { type: "string", description: "First image (base64 or URL)" },
          image2: { type: "string", description: "Second image (base64 or URL)" },
        },
        required: ["image1", "image2"],
      },
    },
    {
      name: "image_analysis",
      description: "General image analysis and understanding",
      server: "vision",
      inputSchema: {
        type: "object",
        properties: {
          image: { type: "string", description: "Base64 encoded image or URL" },
          prompt: { type: "string", description: "What to analyze or describe" },
        },
        required: ["image"],
      },
    },
    {
      name: "video_analysis",
      description: "Analyze video content and extract information",
      server: "vision",
      inputSchema: {
        type: "object",
        properties: {
          video: { type: "string", description: "Video URL or path" },
          prompt: { type: "string", description: "What to analyze in the video" },
        },
        required: ["video"],
      },
    },
  ],
  "web-search": [
    {
      name: "webSearchPrime",
      description: "Search the web for current information. Use this FIRST to discover GitHub repos, documentation URLs, or verify information before using other tools like zread or webReader. Essential for finding correct repo names (owner/repo format).",
      server: "web-search",
      inputSchema: {
        type: "object",
        properties: {
          search_query: { type: "string", description: "Search query text" },
          max_results: { type: "number", description: "Maximum number of results (default: 10)" },
        },
        required: ["search_query"],
      },
    },
  ],
  "web-reader": [
    {
      name: "webReader",
      description: "Read and extract content from a web page URL. IMPORTANT: Only use with URLs discovered via webSearchPrime. Do not guess URLs.",
      server: "web-reader",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to read (must be a verified URL from search results)" },
          extractImages: { type: "boolean", description: "Whether to extract images" },
        },
        required: ["url"],
      },
    },
  ],
  "zread": [
    {
      name: "search_doc",
      description: "Search documentation across GitHub repositories. IMPORTANT: Only use this after you have confirmed the exact repo name exists (e.g., via webSearchPrime). Do not guess repo names.",
      server: "zread",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query for documentation" },
          repo: { type: "string", description: "Optional: specific repo in owner/name format (must be verified to exist first)" },
        },
        required: ["query"],
      },
    },
    {
      name: "get_repo_structure",
      description: "Get the file/directory structure of a GitHub repository. IMPORTANT: Only use after confirming the exact repo name via webSearchPrime. Format: owner/repo (e.g., 'pioner92/opentui', NOT 'opentui' alone).",
      server: "zread",
      inputSchema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "Repository in owner/name format (e.g., 'facebook/react'). Must be verified to exist first." },
          branch: { type: "string", description: "Branch name (default: main)" },
        },
        required: ["repo"],
      },
    },
    {
      name: "read_file",
      description: "Read a file from a GitHub repository. IMPORTANT: First use get_repo_structure to find valid file paths, then read specific files.",
      server: "zread",
      inputSchema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "Repository in owner/name format (e.g., 'facebook/react')" },
          path: { type: "string", description: "File path within the repo (use get_repo_structure to find valid paths)" },
          branch: { type: "string", description: "Branch name (default: main)" },
        },
        required: ["repo", "path"],
      },
    },
  ],
  "context7": [
    {
      name: "resolve-library-id",
      description: "Find the Context7 library ID for a package/library name. Call this first before query-docs.",
      server: "context7",
      inputSchema: {
        type: "object",
        properties: {
          libraryName: { type: "string", description: "Library name to search for (e.g., 'react', 'express')" },
        },
        required: ["libraryName"],
      },
    },
    {
      name: "query-docs",
      description: "Query documentation for a library using its Context7 library ID",
      server: "context7",
      inputSchema: {
        type: "object",
        properties: {
          libraryId: { type: "string", description: "Context7 library ID (from resolve-library-id)" },
          query: { type: "string", description: "Question or topic to search for" },
          maxTokens: { type: "number", description: "Max tokens in response (default: 5000)" },
        },
        required: ["libraryId", "query"],
      },
    },
  ],
};

/**
 * Initialize the tool cache from all connected MCP servers
 */
async function initializeCache(): Promise<void> {
  if (cacheInitialized) return;
  
  // Wait for MCP manager to be ready
  await mcpManager.ensureInitialized();
  
  const servers = mcpManager.getConnectedServers();
  const tools: MCPTool[] = [];
  
  for (const server of servers) {
    const serverName = server.config.name;
    const knownTools = KNOWN_TOOLS[serverName];
    
    if (knownTools) {
      tools.push(...knownTools);
    }
  }
  
  toolCache = tools;
  cacheInitialized = true;
}

/**
 * Ensure cache is initialized (lazy init)
 */
async function ensureCacheInitialized(): Promise<void> {
  if (cacheInitialized) return;
  if (cacheInitPromise) return cacheInitPromise;
  
  cacheInitPromise = initializeCache();
  await cacheInitPromise;
}

/**
 * Simple text matching score
 */
function calculateMatchScore(text: string, query: string): number {
  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/);
  
  // Exact match
  if (textLower === queryLower) return 1.0;
  
  // Contains full query
  if (textLower.includes(queryLower)) return 0.9;
  
  // Count matching words
  let matchedWords = 0;
  for (const word of queryWords) {
    if (word.length >= 2 && textLower.includes(word)) {
      matchedWords++;
    }
  }
  
  if (queryWords.length > 0) {
    return (matchedWords / queryWords.length) * 0.8;
  }
  
  return 0;
}

/**
 * MCP Discovery Service
 */
export const MCPDiscovery = {
  /**
   * Search for tools matching a query
   * Returns ranked results without loading full descriptions into context
   */
  async search(query: string, limit: number = 5): Promise<MCPToolSearchResult[]> {
    await ensureCacheInitialized();
    
    const results: MCPToolSearchResult[] = [];
    
    for (const tool of toolCache) {
      const nameScore = calculateMatchScore(tool.name, query);
      const descScore = calculateMatchScore(tool.description, query);
      
      const maxScore = Math.max(nameScore, descScore);
      
      if (maxScore > 0.1) {
        results.push({
          tool,
          score: maxScore,
          matchedOn: nameScore >= descScore ? "name" : 
                     descScore > nameScore ? "description" : "both",
        });
      }
    }
    
    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    
    return results.slice(0, limit);
  },
  
  /**
   * Get all tools for a specific server
   */
  async getServerTools(serverName: MCPServerName): Promise<MCPTool[]> {
    await ensureCacheInitialized();
    return toolCache.filter(t => t.server === serverName);
  },
  
  /**
   * Get a specific tool by name
   */
  async getTool(serverName: MCPServerName, toolName: string): Promise<MCPTool | undefined> {
    await ensureCacheInitialized();
    return toolCache.find(t => t.server === serverName && t.name === toolName);
  },
  
  /**
   * Get all cached tools
   */
  async getAllTools(): Promise<MCPTool[]> {
    await ensureCacheInitialized();
    return [...toolCache];
  },
  
  /**
   * Get a compact tool list for system prompts
   * Format: "server:tool_name - brief description"
   * This is minimal context to help the agent know what's available
   */
  async getCompactToolList(): Promise<string> {
    await ensureCacheInitialized();
    
    const lines: string[] = [];
    const byServer = new Map<MCPServerName, MCPTool[]>();
    
    for (const tool of toolCache) {
      const existing = byServer.get(tool.server) || [];
      existing.push(tool);
      byServer.set(tool.server, existing);
    }
    
    for (const [server, tools] of byServer) {
      lines.push(`${server}:`);
      for (const tool of tools) {
        // Truncate description to 60 chars
        const shortDesc = tool.description.length > 60 
          ? tool.description.slice(0, 57) + "..."
          : tool.description;
        lines.push(`  - ${tool.name}: ${shortDesc}`);
      }
    }
    
    return lines.join("\n");
  },
  
  /**
   * Format tool for display (with full schema)
   */
  formatToolDetails(tool: MCPTool): string {
    const lines = [
      `Tool: ${tool.name}`,
      `Server: ${tool.server}`,
      `Description: ${tool.description}`,
      "",
      "Parameters:",
    ];
    
    const schema = tool.inputSchema;
    if (schema.properties) {
      const required = schema.required || [];
      for (const [name, prop] of Object.entries(schema.properties)) {
        const isRequired = required.includes(name);
        const reqMarker = isRequired ? " (required)" : "";
        lines.push(`  ${name}: ${prop.type}${reqMarker}`);
        if (prop.description) {
          lines.push(`    ${prop.description}`);
        }
        if (prop.enum) {
          lines.push(`    Options: ${prop.enum.join(", ")}`);
        }
      }
    } else {
      lines.push("  (no parameters)");
    }
    
    return lines.join("\n");
  },
  
  /**
   * Generate example call for a tool
   */
  generateExampleCall(tool: MCPTool): string {
    const args: Record<string, string> = {};
    const schema = tool.inputSchema;
    
    if (schema.properties) {
      const required = schema.required || [];
      for (const [name, prop] of Object.entries(schema.properties)) {
        if (required.includes(name)) {
          // Generate placeholder for required params
          if (prop.enum && prop.enum.length > 0) {
            args[name] = prop.enum[0] as string;
          } else if (prop.type === "string") {
            args[name] = `<${name}>`;
          } else if (prop.type === "number") {
            args[name] = "0";
          } else if (prop.type === "boolean") {
            args[name] = "true";
          }
        }
      }
    }
    
    return `${tool.name}(${JSON.stringify(args)})`;
  },
  
  /**
   * Refresh the tool cache
   */
  async refresh(): Promise<void> {
    cacheInitialized = false;
    cacheInitPromise = null;
    toolCache = [];
    await ensureCacheInitialized();
  },
};
