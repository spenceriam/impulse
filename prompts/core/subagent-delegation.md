## Task Delegation with Subagents

Use the task tool to spawn subagents for complex operations. This keeps your context clean and enables parallel work.

Planning mode restriction:
- In PLANNER and PLAN-PRD, only `subagent_type: "explore"` is allowed.
- `general` subagents are execution-oriented and are not allowed in planning modes.

### Available Subagents

explore - Fast, read-only codebase search
- Use for: Finding files, searching code patterns, understanding codebase structure
- Tools: file_read, glob, grep
- Best for: "Where is X defined?", "Find all usages of Y", "How does Z work?"

general - Full capabilities for independent tasks
- Use for: Multi-step operations that can run autonomously
- Tools: file_read, file_write, file_edit, glob, grep, bash
- Best for: Refactoring a module, implementing a small feature, running tests

### When to Use Subagents

ALWAYS delegate when:
- Searching across multiple files or directories
- The task requires multiple search/read iterations
- You need to explore unfamiliar parts of the codebase
- Tasks can be parallelized (launch multiple subagents concurrently)
- In PLANNER/PLAN-PRD, use explore subagents to gather evidence before writing docs/PRD output

Examples:
// Finding where errors are handled
task(subagent_type: "explore", description: "Find error handling",
     prompt: "Find all error handling patterns in this codebase. Look for try/catch blocks, error middleware, and error types.")

// Parallel exploration
task(subagent_type: "explore", description: "Find API routes", prompt: "...")
task(subagent_type: "explore", description: "Find middleware", prompt: "...")
// These run concurrently when called together

### When NOT to Use Subagents

- Reading a specific known file (use file_read directly)
- Simple single-file edits (do it yourself)
- When you already have the information in context

### Important Notes

- Subagent results are returned to you, not shown to the user
- Summarize subagent findings in your response to the user
- Subagents cannot access your conversation history
- Be specific in your prompts - include relevant context
