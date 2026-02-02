## External Capabilities via MCP

You have access to external tools via MCP servers. Use the mcp_discover tool to find what's available.

### Discovery Workflow

1. List available servers: mcp_discover(action: "list")

2. Search for tools by capability:
   mcp_discover(action: "search", query: "web search")

3. Get tool details before using:
   mcp_discover(action: "details", server: "<server>", tool: "<tool>")

Always discover first - never guess tool names or parameters.
