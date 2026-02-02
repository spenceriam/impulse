import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { resolve, relative, isAbsolute } from "path";
import { sanitizePath } from "../util/path";
import { ask as askPermission } from "../permission";
import { Bus } from "../bus";
import { 
  isPtyAvailable, 
  executePty, 
  PtyEvents,
  type ShellOutputEvent,
  type PtyHandle,
} from "../pty";

const DESCRIPTION = `Run a shell command in a persistent session.

Required: command, description. Optional: workdir, timeout, interactive.
See docs/tools/bash.md for safety rules and usage details.`;

const BashSchema = z.object({
  command: z.string(),
  description: z.string(),
  workdir: z.string().optional(),
  timeout: z.number().optional(),
  interactive: z.boolean().optional(),
});

type BashInput = z.infer<typeof BashSchema>;

interface SpawnOptions {
  cmd: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
}

/**
 * Destructive command patterns (always require permission)
 */
const DESTRUCTIVE_PATTERNS = [
  // File deletion
  /\brm\s+(-[rfivI]+\s+)*[^\s]/,
  /\brmdir\b/,
  /\bunlink\b/,
  /\bshred\b/,

  // Git destructive
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[fd]+\b/,
  /\bgit\s+push\s+.*--force\b/,
  /\bgit\s+push\s+-f\b/,
  /\bgit\s+checkout\s+\.\s*$/,
  /\bgit\s+restore\s+\.\s*$/,

  // Process/System
  /\bkill\s+-9\b/,
  /\bkillall\b/,
  /\bpkill\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bhalt\b/,
  /\bpoweroff\b/,

  // Dangerous file operations
  />\s*\/dev\/(sd|hd|nvme)/,
  /\bdd\s+.*of=/,
  /\bmkfs\b/,
  /\bfdisk\b/,

  // Database destructive
  /\bDROP\s+(TABLE|DATABASE|INDEX)\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b.*WHERE\s*$/i,

  // Package manager uninstalls
  /\bnpm\s+uninstall\b/,
  /\byarn\s+remove\b/,
  /\bpip\s+uninstall\b/,
  /\bapt(-get)?\s+(remove|purge)\b/,
  /\bbrew\s+uninstall\b/,

  // Other dangerous
  /\bchmod\s+777\b/,
  /\bchown\s+-R\b.*\//,
  /\bcurl\s+.*\|\s*(ba)?sh\b/,
  /\bwget\s+.*\|\s*(ba)?sh\b/,
];

/**
 * Commands that typically require interactive input
 */
const INTERACTIVE_COMMANDS = [
  "sudo",
  "su",
  "vim", "nvim", "nano", "emacs",
  "git rebase -i", "git add -i", "git commit -a",
  "npm init", "yarn init", "pnpm init",
  "ssh", "scp",
  "mysql", "psql", "mongo",
  "python", "node", "bun repl",
  "less", "more",
  "top", "htop", "btop",
];

/**
 * Safe command patterns (auto-allow)
 */
const SAFE_PATTERNS = [
  // Read-only git
  /\bgit\s+(status|log|diff|show|branch|tag|remote|fetch)\b/,
  /\bgit\s+ls-/,

  // Directory listing
  /\bls\b/,
  /\bdir\b/,
  /\bfind\s+.*-type\s+[fd]\b/,
  /\bfind\s+.*-name\b/,

  // File viewing
  /\bcat\b/,
  /\bhead\b/,
  /\btail\b/,
  /\bless\b/,
  /\bmore\b/,
  /\bgrep\b/,
  /\brg\b/,
  /\bwc\b/,

  // Environment/info
  /\bpwd\b/,
  /\bwhoami\b/,
  /\becho\s/,
  /\benv\b/,
  /\bprintenv\b/,
  /\bwhich\b/,
  /\btype\b/,
  /\bfile\b/,

  // Package info (not install/uninstall)
  /\bnpm\s+(list|ls|info|view|search)\b/,
  /\byarn\s+(list|info|why)\b/,
  /\bpip\s+(list|show|search)\b/,

  // Build/test (generally safe)
  /\bnpm\s+(run|test|start|build)\b/,
  /\byarn\s+(run|test|start|build)\b/,
  /\bnpx\b/,
  /\bpython\s+-c\b/,
  /\bnode\s+-e\b/,

  // Version checks
  /--version\b/,
  /-v\b$/,
  /\b(node|npm|yarn|python|pip|git|cargo|go)\s+-v\b/,
];

/**
 * Check if a command likely needs interactive mode
 */
function needsInteractiveMode(command: string): boolean {
  const trimmed = command.trim().toLowerCase();
  for (const interactive of INTERACTIVE_COMMANDS) {
    if (trimmed.startsWith(interactive.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * Classify a command as safe, destructive, or unknown
 */
function classifyCommand(command: string): "safe" | "destructive" | "unknown" {
  const trimmed = command.trim();

  // Check destructive first (higher priority)
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return "destructive";
    }
  }

  for (const pattern of SAFE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return "safe";
    }
  }

  return "unknown";
}

/**
 * Check if a path is within the current working directory
 */
function isWithinCwd(targetPath: string, cwd: string): boolean {
  const absoluteTarget = isAbsolute(targetPath) 
    ? targetPath 
    : resolve(cwd, targetPath);
  const relativePath = relative(cwd, absoluteTarget);
  
  // If relative path starts with "..", it's outside cwd
  return !relativePath.startsWith("..");
}

/**
 * Extract paths from a command (basic heuristic)
 */
function extractPaths(command: string): string[] {
  const paths: string[] = [];
  
  // Match absolute paths and relative paths that look like file paths
  const pathPattern = /(?:^|\s)((?:\/[\w.-]+)+|(?:\.\.?\/)?[\w.-]+(?:\/[\w.-]+)*)/g;
  let match;
  
  while ((match = pathPattern.exec(command)) !== null) {
    const path = match[1];
    // Skip if it looks like a flag or option
    if (path && !path.startsWith("-") && (path.includes("/") || path.startsWith("."))) {
      paths.push(path);
    }
  }
  
  return paths;
}

/**
 * Check if command needs permission
 */
function needsPermission(command: string, workdir?: string): { needed: boolean; reason?: string } {
  const cwd = workdir || process.cwd();

  const classification = classifyCommand(command);
  if (classification === "destructive") {
    return { needed: true, reason: "Destructive command" };
  }

  // Check for paths outside cwd (even for safe commands)
  const paths = extractPaths(command);
  for (const path of paths) {
    if (!isWithinCwd(path, cwd)) {
      return { needed: true, reason: `Path outside working directory: ${path}` };
    }
  }

  if (classification === "safe") {
    return { needed: false };
  }

  // Unknown command within cwd - require permission
  return { needed: true, reason: "Unknown command" };
}

/**
 * Store for active PTY handles (for external access to focus/input)
 */
const activePtyHandles = new Map<string, PtyHandle>();

/**
 * Get active PTY handle by tool call ID
 */
export function getActivePtyHandle(toolCallId: string): PtyHandle | undefined {
  return activePtyHandles.get(toolCallId);
}

/**
 * Execute command with PTY (interactive mode)
 */
async function executeWithPty(
  input: BashInput,
  toolCallId: string,
  abortSignal: AbortSignal
): Promise<ToolResult> {
  const cwd = input.workdir ? sanitizePath(input.workdir) : process.cwd();
  const startTime = Date.now();
  
  let lastOutput = "";
  
  const onEvent = (event: ShellOutputEvent) => {
    switch (event.type) {
      case "data":
        lastOutput = typeof event.output === "string" 
          ? event.output 
          : event.output.map(line => line.map(t => t.text).join("")).join("\n");
        // Emit output update via Bus
        Bus.emit(PtyEvents.Output, { toolCallId, output: lastOutput });
        break;
        
      case "prompt_detected":
        // Emit prompt detected via Bus for AI to handle
        Bus.emit(PtyEvents.PromptDetected, { 
          toolCallId, 
          prompt: event.prompt, 
          suggestion: event.suggestion 
        });
        break;
        
      case "exit":
        Bus.emit(PtyEvents.Exited, { 
          toolCallId, 
          exitCode: event.exitCode, 
          signal: event.signal 
        });
        break;
    }
  };
  
  try {
    const handle = await executePty(input.command, cwd, onEvent, abortSignal);
    
    // Store handle for external access
    activePtyHandles.set(toolCallId, handle);
    Bus.emit(PtyEvents.Started, { toolCallId, pid: handle.pid });
    
    // Wait for result
    const result = await handle.result;
    
    // Clean up handle
    activePtyHandles.delete(toolCallId);
    
    const elapsed = Date.now() - startTime;
    const maxLines = 2000;
    const outputLines = result.output.split("\n");
    let output = result.output;
    
    if (outputLines.length >= maxLines) {
      output = outputLines.slice(0, maxLines).join("\n");
      output += `\n[Output truncated to ${maxLines} lines]`;
    }
    
    return {
      success: result.exitCode === 0,
      output: output || "Command completed successfully.",
      metadata: {
        type: "bash",
        command: input.command,
        description: input.description,
        output: output || "Command completed successfully.",
        workdir: input.workdir,
        exitCode: result.exitCode,
        duration: elapsed,
        truncated: outputLines.length >= maxLines,
        interactive: true,
        pid: result.pid,
      },
    };
  } catch (error) {
    activePtyHandles.delete(toolCallId);
    
    return {
      success: false,
      output: error instanceof Error ? error.message : String(error),
      metadata: {
        type: "bash",
        command: input.command,
        description: input.description,
        output: error instanceof Error ? error.message : String(error),
        exitCode: -1,
        truncated: false,
        workdir: input.workdir,
        interactive: true,
      },
    };
  }
}

/**
 * Execute command with standard Bun.spawnSync (non-interactive)
 */
async function executeWithSpawn(input: BashInput): Promise<ToolResult> {
  const startTime = Date.now();
  const maxLines = 2000;

  const spawnOptions: SpawnOptions = {
    cmd: ["bash", "-c", input.command],
    env: process.env,
  };

  if (input.workdir) {
    spawnOptions.cwd = sanitizePath(input.workdir);
  }

  const result = Bun.spawnSync(spawnOptions);

  const stdout = (result.stdout?.toString("utf-8") ?? "") as string;
  const stderr = (result.stderr?.toString("utf-8") ?? "") as string;

  const outputLines = stdout.split("\n");
  let output = "";

  if (outputLines.length >= maxLines) {
    output = outputLines.slice(0, maxLines).join("\n");
    output += `\n[Output truncated to ${maxLines} lines]`;
  } else {
    output = stdout;
  }

  if (stderr) {
    output += `\n${stderr}`;
  }

  const elapsed = Date.now() - startTime;
  const exitCode = result.exitCode ?? 0;
  const wasTruncated = outputLines.length >= maxLines;

  return {
    success: exitCode === 0,
    output: output || "Command completed successfully.",
    metadata: {
      // Legacy fields (keep for backwards compatibility)
      duration: elapsed,
      truncated: wasTruncated,
      exitCode,
      // NEW: BashMetadata fields for enhanced display
      type: "bash",
      command: input.command,
      description: input.description,
      output: output || "Command completed successfully.",
      workdir: input.workdir,
      interactive: false,
    },
  };
}

// Global tool call ID counter (will be replaced with actual tool call ID from agent)
let toolCallCounter = 0;
function generateToolCallId(): string {
  return `bash-${++toolCallCounter}-${Date.now()}`;
}

// Global abort controller for current execution
let currentAbortController: AbortController | null = null;

/**
 * Abort current bash execution (called from UI on user cancel)
 */
export function abortCurrentBashExecution(): void {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
}

export const bashTool: Tool<BashInput> = Tool.define(
  "bash",
  DESCRIPTION,
  BashSchema,
  async (input: BashInput): Promise<ToolResult> => {
    try {
      // Check if permission is needed
      const permCheck = needsPermission(input.command, input.workdir);
      
      if (permCheck.needed) {
        await askPermission({
          sessionID: "current",
          permission: "bash",
          patterns: [input.command],
          message: input.description || `Execute: ${input.command.slice(0, 50)}...`,
          metadata: {
            command: input.command,
            workdir: input.workdir,
            reason: permCheck.reason,
          },
        });
      }
      
      // Determine if we should use interactive mode
      const shouldUseInteractive = input.interactive ?? needsInteractiveMode(input.command);
      
      // Use PTY if interactive mode is requested AND PTY is available
      if (shouldUseInteractive && isPtyAvailable()) {
        const toolCallId = generateToolCallId();
        currentAbortController = new AbortController();
        
        try {
          return await executeWithPty(input, toolCallId, currentAbortController.signal);
        } finally {
          currentAbortController = null;
        }
      }
      
      // Fallback to standard execution
      return await executeWithSpawn(input);
      
    } catch (error) {
      if (error instanceof Error) {
        let output = error.message;

        const stdoutMatch = error.message.match(/\[stdout] (.*)/);
        if (stdoutMatch) {
          output = stdoutMatch[1] ?? "";
        }

        if (error.message.includes("Command timed out")) {
          output += `\n[Timeout after ${input.timeout}ms]`;
        }

        return {
          success: false,
          output,
          metadata: {
            type: "bash",
            command: input.command,
            description: input.description,
            output,
            exitCode: -1,
            truncated: false,
            workdir: input.workdir,
          },
        };
      }

      return {
        success: false,
        output: String(error),
        metadata: {
          type: "bash",
          command: input.command,
          description: input.description,
          output: String(error),
          exitCode: -1,
          truncated: false,
          workdir: input.workdir,
        },
      };
    }
  }
);
