import { createSignal, createMemo, onCleanup, Show } from "solid-js";
import { Colors, Indicators } from "../design";
import { useMode } from "../context/mode";
import { useSession } from "../context/session";
import { useExpress } from "../context/express";
import { mcpManager } from "../../mcp/manager";

// Format model name for display (glm-4.7 -> GLM-4.7)
function formatModelName(model: string): string {
  return model.toUpperCase().replace("GLM-", "GLM-");
}

/**
 * Status Line Component
 * Bottom status bar with comprehensive information display
 * 
 * Full format (session): Model | Mode | Progress | Dir | Branch | MCP: ● | Date
 * Initial format: Model | Dir | Branch | MCP: ● | Date
 * 
 * Props:
 * - isInitialScreen: When true, shows simplified version without mode/context bar
 * 
 * Reactivity:
 * - Mode: Reactive from context (updates when user switches modes)
 * - MCP status: Polls every 2s during init, then every 30s
 * - Git branch: Polls every 5s
 * - Context usage: Reactive from session messages
 */

interface StatusLineProps {
  isInitialScreen?: boolean;
}

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

// Get git branch name (synchronous version using spawnSync-like approach)
async function getGitBranch(): Promise<string> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    
    if (exitCode === 0) {
      return output.trim() || "main";
    }
    return "main";
  } catch {
    return "main";
  }
}

export function StatusLine(props: StatusLineProps) {
  // Reactive signals for polled values
  const [mcpStatus, setMcpStatus] = createSignal<{ connected: number; failed: number; total: number }>({
    connected: 0,
    failed: 0,
    total: 5,
  });
  const [gitBranch, setGitBranch] = createSignal("main");

  // Get contexts - these provide reactive state
  let modeContext: ReturnType<typeof useMode> | null = null;
  let sessionContext: ReturnType<typeof useSession> | null = null;
  let expressContext: ReturnType<typeof useExpress> | null = null;

  try {
    modeContext = useMode();
    sessionContext = useSession();
    expressContext = useExpress();
  } catch {
    // Contexts not available, will use defaults
  }

  // Reactive memo for mode - re-evaluates when modeContext.mode() changes
  const mode = createMemo(() => modeContext?.mode() ?? "AUTO");
  
  // Reactive memo for model
  const model = createMemo(() => sessionContext?.model() ?? "GLM-4.7");
  
  // Reactive memo for express mode
  const isExpress = createMemo(() => expressContext?.express() ?? false);
  
  // Reactive memo for context usage - re-evaluates when messages change
  const progress = createMemo(() => {
    const messages = sessionContext?.messages() ?? [];
    return estimateContextUsage(messages);
  });

  // Reactive memo for MCP indicator color
  // Simple logic: Green = all good, Red = any failure, Yellow = still loading
  const mcpIndicator = createMemo(() => {
    const summary = mcpStatus();
    
    // Still initializing (no status yet) - yellow/dim for "loading"
    if (summary.connected === 0 && summary.failed === 0 && summary.total > 0) {
      return { dot: Indicators.dot, color: Colors.status.warning };
    }
    
    // All servers connected successfully - green
    if (summary.connected === summary.total && summary.total > 0) {
      return { dot: Indicators.dot, color: Colors.status.success };
    }
    
    // Any failures - red (even if some connected)
    // This is more honest than yellow which hides failures
    return { dot: Indicators.dot, color: Colors.status.error };
  });

  // Reactive memo for progress bar
  const progressBar = createMemo(() => buildProgressBar(progress(), 10));

  // Reactive memo for mode color
  const modeColor = createMemo(() => {
    const currentMode = mode();
    return Colors.mode[currentMode as keyof typeof Colors.mode] || Colors.ui.text;
  });

  // Reactive memo for formatted model name
  const displayModel = createMemo(() => formatModelName(model()));

  // Static values (don't change during session)
  const dir = getWorkDir();
  const date = getCurrentDate();

  // Polling setup - using pattern from OpenTUI skill (patterns.md lines 542-558)
  // MCP status polling
  const updateMcpStatus = () => {
    const summary = mcpManager.getConnectionSummary();
    setMcpStatus(summary);
  };

  // Git branch polling
  const updateGitBranch = async () => {
    const branch = await getGitBranch();
    setGitBranch(branch);
  };

  // Initial update
  updateMcpStatus();
  updateGitBranch();

  // Set up polling intervals
  // MCP: Poll every 2s while initializing, switch to 30s once stable
  let mcpIntervalId = setInterval(() => {
    updateMcpStatus();
    
    // Once all connected or all failed, slow down polling
    const summary = mcpManager.getConnectionSummary();
    if (summary.connected + summary.failed === summary.total && summary.total > 0) {
      clearInterval(mcpIntervalId);
      mcpIntervalId = setInterval(updateMcpStatus, 30000);
    }
  }, 2000);

  // Git branch: Poll every 5s
  const gitIntervalId = setInterval(updateGitBranch, 5000);

  // Cleanup intervals on component unmount (per OpenTUI skill gotchas.md)
  onCleanup(() => {
    clearInterval(mcpIntervalId);
    clearInterval(gitIntervalId);
  });

  // Render based on screen type
  if (props.isInitialScreen) {
    // Simplified format for welcome screen
    // Format: Model | [EX] | Dir | Branch | MCP | Date
    return (
      <box height={1} justifyContent="center" flexDirection="row">
        <text fg={Colors.ui.dim}>{displayModel()}</text>
        <Show when={isExpress()}>
          <text fg={Colors.ui.dim}> | </text>
          <text fg={Colors.status.warning}>[EXPRESS]</text>
        </Show>
        <text fg={Colors.ui.dim}> | {dir} |  {gitBranch()} | MCP: </text>
        <text fg={mcpIndicator().color}>{mcpIndicator().dot}</text>
        <text fg={Colors.ui.dim}> | {date}</text>
      </box>
    );
  }

  // Full format for session view
  // Format: Model | [EX] | Mode | Progress | Dir | Branch | MCP | Date
  // [EX] comes right after Model (same position as welcome screen)
  return (
    <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row">
      <text fg={Colors.ui.dim}>{displayModel()}</text>
      <Show when={isExpress()}>
        <text fg={Colors.ui.dim}> | </text>
        <text fg={Colors.status.warning}>[EXPRESS]</text>
      </Show>
      <text fg={Colors.ui.dim}> | </text>
      <text fg={modeColor()}>{mode()}</text>
      <text fg={Colors.ui.dim}> | {progressBar()} | {dir} |  {gitBranch()} | MCP: </text>
      <text fg={mcpIndicator().color}>{mcpIndicator().dot}</text>
      <text fg={Colors.ui.dim}> | {date}</text>
    </box>
  );
}
