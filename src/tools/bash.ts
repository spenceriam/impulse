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

const DESCRIPTION = `Executes a given bash command in a persistent shell session.

Usage:
- All commands run in the project working directory by default
- Use the workdir parameter to run in a different directory
- AVOID using "cd <directory> && <command>" patterns - use workdir instead
- Set interactive=true for commands that require user input (sudo, vim, etc.)

Parameters:
- command (required): The command to execute
- description (required): A clear, concise description of what this command does (5-10 words)
- workdir (optional): The working directory to run the command in
- timeout (optional): Timeout in milliseconds (default 120000 = 2 minutes)
- interactive (optional): Enable interactive mode for commands needing user input

Important Notes:
- Always quote file paths that contain spaces with double quotes
- Output exceeding 2000 lines will be truncated
- Avoid using bash for file operations - use dedicated tools instead:
  - File search: Use Glob (NOT find or ls)
  - Content search: Use Grep (NOT grep or rg)
  - Read files: Use Read (NOT cat/head/tail)
  - Edit files: Use Edit (NOT sed/awk)
  - Write files: Use Write (NOT echo)

Git Safety:
- NEVER update git config
- NEVER run destructive git commands (push --force, hard reset) without explicit user request
- NEVER skip hooks (--no-verify) unless explicitly requested
- NEVER commit changes unless explicitly asked

Interactive Mode:
- Use interactive=true for commands that need user input
- Examples: sudo, vim, nano, git rebase -i, npm init
- User can press Ctrl+F to focus the terminal and type input`;

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
 * Destructive commands that always require permission
 */
const DESTRUCTIVE_COMMANDS = [
  // File/directory deletion
  "rm", "rmdir", "unlink", "shred",
  // Force/dangerous git operations
  "git push --force", "git push -f", "git reset --hard", "git clean -fd",
  // System commands
  "sudo", "su", "chmod", "chown", "chgrp",
  // Package managers that modify system
  "apt", "apt-get", "yum", "dnf", "pacman", "brew install", "brew uninstall",
  // Process control
  "kill", "killall", "pkill",
  // Disk operations
  "mkfs", "fdisk", "dd",
  // Network
  "iptables", "ufw",
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
 * Safe read-only commands that don't need permission
 */
const SAFE_COMMANDS = [
  // Read-only file operations
  "ls", "cat", "head", "tail", "less", "more", "file", "stat", "wc", "du", "df",
  "find", "locate", "which", "whereis", "type",
  // Text processing (read-only)
  "grep", "rg", "ag", "ack", "sed -n", "awk",
  // Git read operations
  "git status", "git log", "git diff", "git show", "git branch", "git remote -v",
  "git fetch", "git ls-files", "git rev-parse", "git describe", "git tag -l",
  // Build/test commands
  "npm run", "npm test", "npm install", "npm ci", "npm ls",
  "bun run", "bun test", "bun install", "bun build",
  "yarn", "pnpm",
  "cargo build", "cargo test", "cargo check", "cargo clippy",
  "make", "cmake",
  "go build", "go test", "go mod",
  "python -m pytest", "pytest", "python -m unittest",
  "jest", "vitest", "mocha",
  // Info commands
  "echo", "printf", "date", "pwd", "whoami", "hostname", "uname", "env", "printenv",
  "node -v", "npm -v", "bun -v", "python --version", "git --version",
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
 * Check if a command is safe (doesn't need permission)
 */
function isSafeCommand(command: string): boolean {
  const trimmed = command.trim().toLowerCase();
  
  // Check for destructive commands first (they override safe)
  for (const destructive of DESTRUCTIVE_COMMANDS) {
    if (trimmed.startsWith(destructive.toLowerCase())) {
      return false;
    }
  }
  
  // Check if it's a known safe command
  for (const safe of SAFE_COMMANDS) {
    if (trimmed.startsWith(safe.toLowerCase())) {
      return true;
    }
  }
  
  // Default: require permission for unknown commands
  return false;
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
  
  // Check if it's a safe command
  if (isSafeCommand(command)) {
    return { needed: false };
  }
  
  // Check for destructive commands
  const trimmed = command.trim().toLowerCase();
  for (const destructive of DESTRUCTIVE_COMMANDS) {
    if (trimmed.startsWith(destructive.toLowerCase())) {
      return { needed: true, reason: `Destructive command: ${destructive}` };
    }
  }
  
  // Check for paths outside cwd
  const paths = extractPaths(command);
  for (const path of paths) {
    if (!isWithinCwd(path, cwd)) {
      return { needed: true, reason: `Path outside working directory: ${path}` };
    }
  }
  
  // Unknown command within cwd - still ask but could be less strict
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
