import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { resolve, relative, isAbsolute } from "path";
import path from "path";
import { statSync } from "fs";
import { resolveToolPath } from "./resolve-tool-path.js";
import { ask as askPermission } from "../permission";
import { Bus } from "../bus";
import { 
  isPtyAvailable, 
  executePty, 
  PtyEvents,
  type ShellOutputEvent,
  type PtyHandle,
} from "../pty";
import { zCommandString, zFilePath } from "./schemas/branded";
import { detectPowerShellVersion, translatePosixToPowerShell } from "./posix-translation";
import { detectShellEnvironment } from "../util/shell-env";
import { detectAndPublishBranchChange } from "../git/branch-detect";
import { SessionManager } from "../session/manager";
import { capBashOutputLines } from "../util/tool-output-cap.js";

/** Default bash/PTY timeout per docs/tools/bash.md */
const DEFAULT_BASH_TIMEOUT_MS = 120_000;

const DESCRIPTION = `Run a shell command in the host platform shell.

On Windows this uses PowerShell. On macOS/Linux this uses bash.
Required: command, description. Optional: workdir, timeout, interactive, session.
See docs/tools/bash.md for safety rules and usage details.`;

const BashSchema = z.object({
  command: zCommandString(),
  description: z.string(),
  workdir: zFilePath().optional(),
  timeout: z.number().optional(),
  interactive: z.boolean().optional(),
  session: z.string().optional().describe("Optional named shell session; preserves cwd between bash calls"),
  resetSession: z.boolean().optional().describe("Reset the named shell session before running"),
});

type BashInput = z.infer<typeof BashSchema>;

interface SpawnOptions {
  cmd: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
}

interface ShellSessionState {
  cwd: string;
}

const shellSessions = new Map<string, ShellSessionState>();
const sessionChains = new Map<string, Promise<unknown>>();

function isValidSessionCwd(cwd: string): boolean {
  try {
    return statSync(cwd).isDirectory();
  } catch {
    return false;
  }
}

async function withSessionLock<T>(
  sessionName: string,
  fn: () => Promise<T>
): Promise<T> {
  const previous = sessionChains.get(sessionName) ?? Promise.resolve();
  const run = previous
    .catch(() => {
      /* keep chain alive after prior failure */
    })
    .then(() => fn());
  sessionChains.set(sessionName, run);
  try {
    return await run;
  } finally {
    if (sessionChains.get(sessionName) === run) {
      sessionChains.delete(sessionName);
    }
  }
}

function normalizeSessionName(name?: string): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  // Hex-encode disallowed chars so distinct names (e.g. foo@bar vs foo_bar) stay unique.
  const encoded = trimmed.replace(/[^\w.-]/g, (ch) =>
    `_x${ch.charCodeAt(0).toString(16).padStart(2, "0")}_`
  );
  return encoded.slice(0, 60);
}

function resolveSessionCwd(
  sessionName: string | null,
  fallbackCwd: string,
  options?: { reset?: boolean; workdirProvided?: boolean }
): string {
  if (!sessionName) return fallbackCwd;
  if (options?.reset) shellSessions.delete(sessionName);
  const existing = shellSessions.get(sessionName);
  if (existing) {
    if (options?.workdirProvided) {
      shellSessions.set(sessionName, { cwd: fallbackCwd });
      return fallbackCwd;
    }
    if (isValidSessionCwd(existing.cwd)) {
      return existing.cwd;
    }
    shellSessions.set(sessionName, { cwd: fallbackCwd });
    return fallbackCwd;
  }
  shellSessions.set(sessionName, { cwd: fallbackCwd });
  return fallbackCwd;
}

function parseCdTarget(command: string): string | null {
  const trimmed = command.trim();
  const cleanTarget = (raw: string): string => raw.trim().replace(/^['"]|['"]$/g, "");

  // Leading cd before a chain operator (e.g. `cd dir && npm test`).
  // Check chained forms before lone forms so the target does not greedily
  // capture the rest of the command.
  const chainedMatch =
    trimmed.match(/^(?:cd|Set-Location)\s+(.+?)\s*(?:&&|\|\||;)\s*/i) ??
    trimmed.match(/^Push-Location\s+(.+?)\s*(?:&&|\|\||;)\s*/i);
  if (chainedMatch?.[1]) return cleanTarget(chainedMatch[1]);

  const loneMatch =
    trimmed.match(/^(?:cd|Set-Location)\s+(.+)$/i) ??
    trimmed.match(/^Push-Location\s+(.+)$/i);
  if (loneMatch?.[1]) return cleanTarget(loneMatch[1]);

  return null;
}

function updateSessionCwd(sessionName: string | null, cwd: string, command: string): void {
  if (!sessionName) return;
  const rawTarget = parseCdTarget(command);
  if (!rawTarget) return;
  const next = path.resolve(cwd, rawTarget);
  try {
    if (!statSync(next).isDirectory()) return;
  } catch {
    return;
  }
  shellSessions.set(sessionName, { cwd: next });
}

const WINDOWS_COMMAND_ENV_VAR = "IMPULSE_COMMAND";
const WINDOWS_POWERSHELL_WRAPPER = `
$ErrorActionPreference = 'Continue'
$impulseCommand = [Environment]::GetEnvironmentVariable('${WINDOWS_COMMAND_ENV_VAR}', 'Process')
$impulseExitCode = 0

try {
  $global:LASTEXITCODE = 0
  $impulseErrorCount = $Error.Count
  $impulseOutput = & ([scriptblock]::Create($impulseCommand)) *>&1
  $impulseSuccess = $?
  $impulseNativeExit = $global:LASTEXITCODE

  if ($null -ne $impulseOutput) {
    $impulseOutput | Out-String -Width 4096 | Write-Output
  }

  if ($impulseNativeExit -is [int] -and $impulseNativeExit -ne 0) {
    $impulseExitCode = [int]$impulseNativeExit
  } elseif (-not $impulseSuccess -or $Error.Count -gt $impulseErrorCount) {
    $impulseExitCode = 1
  }
} catch {
  $_ | Out-String -Width 4096 | Write-Output
  $impulseExitCode = 1
}

exit $impulseExitCode
`.trim();

/**
 * High-risk command patterns (require permission)
 *
 * This is intentionally broader than strictly destructive deletes:
 * anything that can erase data, rewrite history, publish/deploy, escalate
 * privileges, or pipe network content into a shell should be reviewed.
 */
const HIGH_RISK_PATTERNS = [
  // File deletion / overwrite
  /\brm\s+(-[rfivI]+\s+)*[^\s]/,
  /\brmdir\b/,
  /\bunlink\b/,
  /\bshred\b/,
  /\bdel\s+\/?[fq]?\b/i,
  /\berase\b/i,
  /\bRemove-Item\b/i,

  // Git destructive / remote side-effects
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[fdx]+\b/,
  /\bgit\s+push\b/,
  /\bgit\s+checkout\s+\.\s*$/,
  /\bgit\s+restore\s+\.\s*$/,
  /\bgit\s+rebase\s+--abort\b/,

  // Privilege escalation / process / system
  /\bsudo\b/,
  /\brunas\b/i,
  /\bStart-Process\b.*-Verb\s+RunAs\b/i,
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
  /\bformat(?:\.com)?\s+[A-Za-z]:/i,
  /\bformat\s+\/fs:/i,
  /\bFormat-Volume\b/i,

  // Database destructive
  /\bDROP\s+(TABLE|DATABASE|INDEX)\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b.*WHERE\s*$/i,

  // Package manager / publishing / deploy
  /\bnpm\s+uninstall\b/,
  /\byarn\s+remove\b/,
  /\bpip\s+uninstall\b/,
  /\bapt(-get)?\s+(remove|purge)\b/,
  /\bbrew\s+uninstall\b/,
  /\bnpm\s+publish\b/,
  /\bbun\s+publish\b/,
  /\bgh\s+release\s+create\b/,
  /\b(vercel|netlify|wrangler)\s+deploy\b/,

  // Other dangerous
  /\bchmod\s+777\b/,
  /\bchown\s+-R\b.*\//,
  /\bcurl\s+.*\|\s*(ba)?sh\b/,
  /\bwget\s+.*\|\s*(ba)?sh\b/,
  /\bInvoke-WebRequest\b.*\|/i,
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
 * Safe/benign command patterns (auto-allow)
 */
const SAFE_PATTERNS = [
  // Read-only git
  /\bgit\s+(status|log|diff|show|branch|tag|remote|fetch)\b/,
  /\bgit\s+ls-/,

  // Directory listing / navigation
  /\bls\b/,
  /\bdir\b/,
  /\bfind\s+.*-type\s+[fd]\b/,
  /\bfind\s+.*-name\b/,
  /\bGet-ChildItem\b/i,
  /\bGet-Location\b/i,
  /\bResolve-Path\b/i,
  /\bTest-Path\b/i,
  /\bcd\b/,

  // File viewing / searching
  /\bcat\b/,
  /\bhead\b/,
  /\btail\b/,
  /\bless\b/,
  /\bmore\b/,
  /\bgrep\b/,
  /\brg\b/,
  /\bwc\b/,
  /\bGet-Content\b/i,
  /\bSelect-String\b/i,
  /\bFormat-(Table|List|Wide)\b/i,

  // Environment/info
  /\bpwd\b/,
  /\bwhoami\b/,
  /\becho\s/,
  /\benv\b/,
  /\bprintenv\b/,
  /\bwhich\b/,
  /\btype\b/,
  /\bfile\b/,
  /\bGet-Command\b/i,
  /\bGet-Date\b/i,

  // Package info (not install/uninstall)
  /\bnpm\s+(list|ls|info|view|search)\b/,
  /\byarn\s+(list|info|why)\b/,
  /\bpip\s+(list|show|search)\b/,
  /\bbun\s+(pm|why|outdated)\b/,

  // Local build/test/dev flows (non-destructive)
  /\bnpm\s+(run|test|start|build)\b/,
  /\byarn\s+(run|test|start|build)\b/,
  /\bbun\s+(run|test|x)\b/,
  /\bnpx\b/,
  /\bpython\s+-c\b/,
  /\bnode\s+-e\b/,

  // Benign local filesystem creation
  /\bmkdir\b/,
  /\bmd\b/i,
  /\bNew-Item\b.*-ItemType\s+Directory\b/i,

  // Version checks
  /--version\b/,
  /-v\b$/,
  /\b(node|npm|yarn|python|pip|git|cargo|go|bun|pwsh|powershell)\s+-v\b/,
];

/**
 * Check if a command likely needs interactive mode
 */
export function needsInteractiveMode(command: string): boolean {
  const trimmed = command.trim().toLowerCase();
  for (const interactive of INTERACTIVE_COMMANDS) {
    if (trimmed.startsWith(interactive.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * Classify a command as safe, high-risk, or unknown.
 */
export function classifyCommand(command: string): "safe" | "high_risk" | "unknown" {
  const trimmed = command.trim();

  for (const pattern of HIGH_RISK_PATTERNS) {
    if (pattern.test(trimmed)) {
      return "high_risk";
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
  return relativePath !== ".." && !relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function isPathLikeToken(token: string): boolean {
  return (
    token.startsWith(".") ||
    token.startsWith("/") ||
    token.startsWith("~") ||
    token.includes("/") ||
    token.includes("\\") ||
    /^[A-Za-z]:[\\/]/.test(token) ||
    token.startsWith("\\\\")
  );
}

/**
 * Extract path-like arguments from a command (cross-platform heuristic)
 */
function extractPaths(command: string): string[] {
  return tokenizeCommand(command)
    .filter((token) => token.length > 0 && !token.startsWith("-") && isPathLikeToken(token));
}

function quotePowerShellString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function normalizeWindowsCommand(command: string, shellType: "powershell5" | "powershell7"): string {
  const trimmed = command.trim();
  const chaining = detectPowerShellVersion(trimmed);

  if (shellType === "powershell5" && chaining.hasChainingOperator && chaining.recommendation) {
    return `Write-Error ${quotePowerShellString(chaining.recommendation)}; exit 1`;
  }

  // Use POSIX translation for Windows commands
  const { translated } = translatePosixToPowerShell(trimmed);

  return translated;
}

function encodePowerShellCommand(command: string): string {
  return Buffer.from(command, "utf16le").toString("base64");
}

async function getSpawnOptions(
  input: BashInput,
  cwd: string,
  options: { interactive?: boolean } = {}
): Promise<SpawnOptions> {
  const common: SpawnOptions = {
    cwd,
    env: process.env,
    cmd: [],
  };

  if (process.platform === "win32") {
    const shellEnv = await detectShellEnvironment();
    const commandShellType = shellEnv.commandShellType === "powershell7" ? "powershell7" : "powershell5";
    const executable = commandShellType === "powershell7" ? "pwsh" : "powershell.exe";
    const interactiveArgs = options.interactive ? [] : ["-NonInteractive"];

    return {
      ...common,
      env: {
        ...process.env,
        [WINDOWS_COMMAND_ENV_VAR]: normalizeWindowsCommand(input.command, commandShellType),
      },
      cmd: [
        executable,
        "-NoLogo",
        "-NoProfile",
        ...interactiveArgs,
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodePowerShellCommand(WINDOWS_POWERSHELL_WRAPPER),
      ],
    };
  }

  return {
    ...common,
    cmd: ["bash", "-lc", input.command],
  };
}

/**
 * Check if command needs permission.
 *
 * Policy:
 * - High-risk commands always require approval
 * - Any command touching paths outside the working directory requires approval
 * - Safe and unknown commands within the working directory are allowed
 */
export function needsPermission(command: string, workdir?: string): { needed: boolean; reason?: string } {
  const cwd = workdir || process.cwd();

  const classification = classifyCommand(command);
  if (classification === "high_risk") {
    return { needed: true, reason: "High-risk command" };
  }

  if (classification === "unknown") {
    return { needed: true, reason: "Unrecognized command — approval required" };
  }

  for (const path of extractPaths(command)) {
    if (!isWithinCwd(path, cwd)) {
      return { needed: true, reason: `Path outside working directory: ${path}` };
    }
  }

  return { needed: false };
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
  abortSignal: AbortSignal,
  cwd: string
): Promise<ToolResult> {
  const startTime = Date.now();
  
  let lastOutput = "";
  
  const onEvent = (event: ShellOutputEvent) => {
    switch (event.type) {
      case "data":
        lastOutput = typeof event.output === "string" 
          ? event.output 
          : event.output.map((line: Array<{ text: string }>) => line.map((t: { text: string }) => t.text).join("")).join("\n");
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
    const spawnOptions = process.platform === "win32" ? await getSpawnOptions(input, cwd, { interactive: true }) : undefined;
    const ptyOptions = spawnOptions
      ? (() => {
          const [shell, ...args] = spawnOptions.cmd;
          if (!shell) {
            throw new Error("Windows PTY shell command was not configured");
          }
          return {
            shell,
            args,
            ...(spawnOptions.env ? { env: spawnOptions.env } : {}),
          };
        })()
      : undefined;
    const handle = await executePty(
      input.command,
      cwd,
      onEvent,
      abortSignal,
      80,
      24,
      ptyOptions
    );
    
    // Store handle for external access
    activePtyHandles.set(toolCallId, handle);
    Bus.emit(PtyEvents.Started, { toolCallId, pid: handle.pid });
    
    const timeoutMs = input.timeout ?? DEFAULT_BASH_TIMEOUT_MS;
    let timedOut = false;
    const result = await new Promise<{ output: string; exitCode: number; pid?: number }>((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          handle.kill();
        } catch {
          /* ignore */
        }
        resolve({
          output: lastOutput,
          exitCode: -1,
          pid: handle.pid,
        });
      }, timeoutMs);

      void handle.result.then((ptyResult) => {
        clearTimeout(timer);
        if (!timedOut) resolve(ptyResult);
      });
    });
    
    // Clean up handle
    activePtyHandles.delete(toolCallId);
    
    const elapsed = Date.now() - startTime;
    const maxLines = 2000;
    const capped = capBashOutputLines(result.output, maxLines);
    let output = capped.output;

    if (timedOut) {
      output = `${output}${output ? "\n" : ""}[Timeout after ${timeoutMs}ms]`;
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
        truncated: capped.truncated,
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
 * Execute command with standard Bun.spawn (non-interactive, host-shell aware)
 */
async function executeWithSpawn(input: BashInput, cwd: string): Promise<ToolResult> {
  const startTime = Date.now();
  const maxLines = 2000;
  const spawnOptions = await getSpawnOptions(input, cwd);

  const proc = Bun.spawn({
    cmd: spawnOptions.cmd,
    ...(spawnOptions.cwd ? { cwd: spawnOptions.cwd } : {}),
    ...(spawnOptions.env ? { env: spawnOptions.env } : {}),
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdoutPromise = proc.stdout ? new Response(proc.stdout).text() : Promise.resolve("");
  const stderrPromise = proc.stderr ? new Response(proc.stderr).text() : Promise.resolve("");

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = input.timeout;
  const timeoutPromise = new Promise<number>((resolve) => {
    if (timeoutMs === undefined) {
      return;
    }

    timeoutId = setTimeout(() => {
      proc.kill();
      resolve(-1);
    }, timeoutMs);
  });

  const exitCode = timeoutMs === undefined
    ? await proc.exited
    : await Promise.race([proc.exited, timeoutPromise]);

  if (timeoutId) clearTimeout(timeoutId);

  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  
  // Cross-platform output handling
  // - Windows: Merge captured stdout and stderr after PowerShell execution
  // - macOS/Linux: Merge stdout and stderr, preserve both streams
  const shell = process.platform === "win32" ? "powershell" : "bash";
  let combinedOutput: string;
  
  if (shell === "powershell") {
    // Windows: Output is already processed, but stderr might still have content
    combinedOutput = [stdout, stderr].filter((part) => part.trim().length > 0).join("\n").trim();
  } else {
    // macOS/Linux: Intelligently merge streams
    // If both exist, show stdout first, then stderr as a separate section
    const hasStdout = stdout.trim().length > 0;
    const hasStderr = stderr.trim().length > 0;
    
    if (hasStdout && hasStderr) {
      combinedOutput = `${stdout.trim()}\n\n[stderr]\n${stderr.trim()}`;
    } else if (hasStdout) {
      combinedOutput = stdout.trim();
    } else if (hasStderr) {
      combinedOutput = stderr.trim();
    } else {
      combinedOutput = "";
    }
  }
  
  const capped = capBashOutputLines(combinedOutput, maxLines);
  let output = capped.output;
  let wasTruncated = capped.truncated;

  if (exitCode === -1) {
    output = `${output}${output ? "\n" : ""}[Timeout after ${timeoutMs}ms]`;
  }

  const elapsed = Date.now() - startTime;

  return {
    success: exitCode === 0,
    output: output || "Command completed successfully.",
    metadata: {
      duration: elapsed,
      truncated: wasTruncated,
      exitCode,
      type: "bash",
      command: input.command,
      description: input.description,
      output: output || "Command completed successfully.",
      workdir: input.workdir,
      interactive: false,
      shell,
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
    const sessionName = normalizeSessionName(input.session);

    const runBash = async (): Promise<ToolResult> => {
      const baseCwd = input.workdir
        ? await resolveToolPath(input.workdir, "bash")
        : process.cwd();
      const cwd = resolveSessionCwd(sessionName, baseCwd, {
        workdirProvided: !!input.workdir,
        ...(input.resetSession ? { reset: true } : {}),
      });

      // Check if permission is needed
      const permCheck = needsPermission(input.command, cwd);

      if (permCheck.needed) {
        await askPermission({
          sessionID: SessionManager.getCurrentSessionID() ?? "unknown",
          permission: "bash",
          patterns: [input.command],
          message: input.description || `Execute: ${input.command.slice(0, 50)}...`,
          metadata: {
            command: input.command,
            workdir: input.workdir,
            description: input.description,
            reason:
              input.description?.trim() ||
              permCheck.reason ||
              "Run a shell command on your machine",
          },
        });
      }

      // Determine if we should use interactive mode
      const shouldUseInteractive = input.interactive ?? needsInteractiveMode(input.command);
      let result: ToolResult;

      // Use PTY if interactive mode is requested AND PTY is available
      if (shouldUseInteractive && isPtyAvailable()) {
        const toolCallId = generateToolCallId();
        currentAbortController = new AbortController();
        
        try {
          result = await executeWithPty(input, toolCallId, currentAbortController.signal, cwd);
        } finally {
          currentAbortController = null;
        }
      } else {
        // Fallback to standard execution
        result = await executeWithSpawn(input, cwd);
      }

      updateSessionCwd(sessionName, cwd, input.command);
      if (result.success) {
        detectAndPublishBranchChange(input.command, cwd);
      }
      if (sessionName) {
        result.metadata = {
          ...(result.metadata ?? {}),
          session: sessionName,
          sessionCwd: shellSessions.get(sessionName)?.cwd ?? cwd,
        };
      }
      return result;
    };

    try {
      return sessionName
        ? await withSessionLock(sessionName, runBash)
        : await runBash();
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
