import { Colors, Indicators } from "../design";
import { useMode } from "../context/mode";
import { useSession } from "../context/session";

/**
 * Status Line Component
 * Bottom status bar with comprehensive information display
 * 
 * Format: Model | Mode | Progress | Dir | Branch | MCPs | Date
 * 
 * Uses nested <span> elements inside <text> for inline color styling.
 * See: .opencode/skill/opentui/references/components/text-display.md
 * 
 * Note: The OpenTUI types for SpanProps don't include `fg` prop, but the
 * runtime supports it. Using @ts-expect-error until types are updated.
 */

// Get truncated working directory
function getWorkDir(): string {
  const cwd = process.cwd();
  const home = process.env["HOME"] || "";
  return cwd.replace(home, "~");
}

// Get current date formatted
function getCurrentDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const year = now.getFullYear();
  return `${month}-${day}-${year}`;
}

// Estimate context usage percentage (simplified)
function estimateContextUsage(messages: { content: string }[]): number {
  // Rough estimate: ~4 chars per token, 200k context window
  const totalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
  const estimatedTokens = totalChars / 4;
  const contextWindow = 200000; // GLM-4.7 context window
  return Math.min(100, Math.round((estimatedTokens / contextWindow) * 100));
}

// Build progress bar string
function buildProgressBar(percent: number, width: number = 10): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return `[${Indicators.progress.filled.repeat(filled)}${Indicators.progress.empty.repeat(empty)}] ${percent}%`;
}

export function StatusLine() {
  // Try to use contexts, fall back to defaults if not available
  let model = "GLM-4.7";
  let mode = "AUTO";
  let progress = 0;

  try {
    const modeContext = useMode();
    const sessionContext = useSession();
    
    model = sessionContext.model();
    mode = modeContext.mode();
    progress = estimateContextUsage(sessionContext.messages());
  } catch {
    // Contexts not available, use defaults
  }

  const dir = getWorkDir();
  const branch = "main"; // TODO: Get from git
  const mcpStatus = "4/4"; // TODO: Get from MCP manager
  const date = getCurrentDate();
  const progressBar = buildProgressBar(progress, 10);

  // Build status line as plain text - using text fg for overall dim color
  // Note: For colored inline sections, we'd need proper span support
  // The OpenTUI span types don't include fg prop, so we use a simpler approach
  const statusText = `${model} | ${mode} | ${progressBar} | ${dir} |  ${branch} | MCPs: ${mcpStatus} | ${date}`;

  return (
    <box height={1} paddingLeft={1} paddingRight={1}>
      <text fg={Colors.ui.dim}>{statusText}</text>
    </box>
  );
}
