export const buildAgent = {
  name: "build",
  tools: ["all"],
  description: "Primary agent with full tool access for complex coding tasks",
};

export const exploreAgent = {
  name: "explore",
  tools: ["file_read", "glob", "grep"],
  description: "Fast agent for codebase search and analysis with read-only tools",
};

export const generalAgent = {
  name: "general",
  tools: ["file_read", "file_write", "file_edit", "bash"],
  description: "General-purpose agent for complex multi-step tasks",
};
