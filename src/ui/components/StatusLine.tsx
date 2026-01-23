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

// Compact thresholds
const COMPACT_WARNING_THRESHOLD = 70;  // Show "Compacting soon" at 70%
const COMPACT_TRIGGER_THRESHOLD = 85;  // Auto-compact triggers at 85%

// Calculate context usage percentage from actual token usage
function calculateContextUsage(inputTokens: number, outputTokens: number): number {
  const totalTokens = inputTokens + outputTokens;
  const contextWindow = 200000; // GLM-4.7 context window
  return Math.min(100, Math.round((totalTokens / contextWindow) * 100));
}

// Fallback: Estimate context usage from message content when no token data available
function estimateContextUsage(messages: { content: string }[]): number {
  // Rough estimate: ~4 chars per token, 200k context window
  const totalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
  const estimatedTokens = totalChars / 4;
  const contextWindow = 200000; // GLM-4.7 context window
  return Math.min(100, Math.round((estimatedTokens / contextWindow) * 100));
}

// Build progress bar string with optional warning state
function buildProgressBar(percent: number, width: number = 10): { bar: string; warning: boolean } {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = `[${Indicators.progress.filled.repeat(filled)}${Indicators.progress.empty.repeat(empty)}] ${percent}%`;
  const warning = percent >= COMPACT_WARNING_THRESHOLD && percent < COMPACT_TRIGGER_THRESHOLD;
  return { bar, warning };
}

// Check if compacting soon (70-84%)
function isCompactingSoon(percent: number): boolean {
  return percent >= COMPACT_WARNING_THRESHOLD && percent < COMPACT_TRIGGER_THRESHOLD;
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
  const [mcpStatus, setMcpStatus] = createSignal<{ connected: number; failed: number; total: number; waitingForApiKey?: boolean }>({
    connected: 0,
    failed: 0,
    total: 5,
    waitingForApiKey: false,
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
  
  // Reactive memo for context usage - uses actual token data when available
  const progress = createMemo(() => {
    const stats = sessionContext?.stats();
    if (stats && stats.tokens && (stats.tokens.input > 0 || stats.tokens.output > 0)) {
      // Use actual token counts from API responses
      return calculateContextUsage(stats.tokens.input, stats.tokens.output);
    }
    // Fallback to estimate from message content
    const messages = sessionContext?.messages() ?? [];
    return estimateContextUsage(messages);
  });

  // Reactive memo for MCP indicator color
  // Simple logic: Green = all good, Red = any failure, Yellow = still loading, Dim = waiting for API key
  const mcpIndicator = createMemo(() => {
    const summary = mcpStatus();
    
    // Waiting for API key - dim/gray
    if (summary.waitingForApiKey) {
      return { dot: Indicators.dot, color: Colors.ui.dim, label: "MCP: waiting" };
    }
    
    // Still initializing (no status yet) - yellow/dim for "loading"
    if (summary.connected === 0 && summary.failed === 0 && summary.total > 0) {
      return { dot: Indicators.dot, color: Colors.status.warning, label: "MCP:" };
    }
    
    // All servers connected successfully - green
    if (summary.connected === summary.total && summary.total > 0) {
      return { dot: Indicators.dot, color: Colors.status.success, label: "MCP:" };
    }
    
    // Any failures - red (even if some connected)
    // This is more honest than yellow which hides failures
    return { dot: Indicators.dot, color: Colors.status.error, label: "MCP:" };
  });

  // Reactive memo for progress bar with warning state
  const progressBarData = createMemo(() => buildProgressBar(progress(), 10));
  const progressBar = createMemo(() => progressBarData().bar);
  const showCompactWarning = createMemo(() => isCompactingSoon(progress()));

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
        <text fg={Colors.ui.dim}> | {dir} |  {gitBranch()} | </text>
        <text fg={mcpIndicator().color}>{mcpIndicator().label} {mcpIndicator().dot}</text>
        <text fg={Colors.ui.dim}> | {date}</text>
      </box>
    );
  }

  // Reactive memo for progress bar color (yellow when compacting soon)
  const progressColor = createMemo(() => 
    showCompactWarning() ? Colors.status.warning : Colors.ui.dim
  );

  // Full format for session view
  // Format: Model | [EX] | Mode | Progress [Compacting soon] | Dir | Branch | MCP | Date
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
      <text fg={Colors.ui.dim}> | </text>
      <text fg={progressColor()}>{progressBar()}</text>
      <Show when={showCompactWarning()}>
        <text fg={Colors.status.warning}> Compacting soon</text>
      </Show>
      <text fg={Colors.ui.dim}> | {dir} |  {gitBranch()} | </text>
      <text fg={mcpIndicator().color}>{mcpIndicator().label} {mcpIndicator().dot}</text>
      <text fg={Colors.ui.dim}> | {date}</text>
    </box>
  );
}
