/**
 * Advisor pre-consult tool gate — blocks mutating tools until consult_advisor runs.
 */

const ALWAYS_BLOCKED = new Set(["file_write", "file_edit", "task", "todo_write"]);

/** Known read-only command prefixes (first token / git subcommand). */
const READONLY_BASH_PREFIX =
  /^(ls|dir|cat|head|tail|wc|grep|find|which|where|type|pwd|echo|printenv|env|whoami|date|uname|git\s+status|git\s+log|git\s+branch|git\s+diff)\b/i;

/** Obvious mutating prefixes — checked before allowlist. */
const MUTATING_BASH_PREFIX =
  /^(rm|mv|cp|mkdir|touch|chmod|chown|npm|npx|bun|yarn|pnpm|pip|cargo|make|sed|tee|curl|wget|docker|kubectl|helm|terraform|python|node|php|ruby|go\s+run|git\s+(commit|push|merge|rebase|checkout|reset|clean|stash))/i;

export const ADVISOR_GATE_MESSAGE =
  "[GATE] Advisor workflow is active. Call consult_advisor before file writes, edits, non-readonly bash, or subagent launches.";

export function isReadOnlyBashCommand(command: string): boolean {
  const cmd = command.trim();
  if (!cmd) return false;
  if (MUTATING_BASH_PREFIX.test(cmd)) return false;
  return READONLY_BASH_PREFIX.test(cmd);
}

export function shouldBlockBeforeAdvisor(
  toolName: string,
  args: Record<string, unknown>
): boolean {
  if (ALWAYS_BLOCKED.has(toolName)) return true;
  if (toolName !== "bash") return false;

  const command = args["command"];
  if (typeof command !== "string" || !command.trim()) return true;
  return !isReadOnlyBashCommand(command);
}
