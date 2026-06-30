/**
 * Cross-Platform Shell Environment Detection
 * 
 * Detects host shell capabilities and environment information for
 * better cross-platform command execution and agent guidance.
 * 
 * Supports:
 * - Windows: PowerShell 5.x, PowerShell 7.x (pwsh)
 * - macOS: bash, zsh (default on modern macOS), fish
 * - Linux: bash, zsh, fish, sh
 */

export interface ShellEnvironment {
  platform: "Windows" | "macOS" | "Linux";
  /** User's configured login shell, detected from the host environment. */
  shell: string;
  shellVersion?: string;
  shellType: WindowsCommandShellType | "bash" | "zsh" | "fish" | "sh" | "unknown";
  /** Shell actually used by the bash tool for command execution. */
  commandShell: string;
  commandShellType: WindowsCommandShellType | "bash" | "wsl";
  supportsChainedCommands: boolean;
  commandSeparator: string; // ; or && depending on shell
  recommendations: string[];
  tips: string[];
}

let cachedShellEnvironment: Promise<ShellEnvironment> | undefined;
const SHELL_DETECTION_TIMEOUT_MS = 1500;

function streamToText(
  stream: ReadableStream<Uint8Array> | number | null | undefined
): Promise<string> {
  return stream instanceof ReadableStream
    ? new Response(stream).text().catch(() => "")
    : Promise.resolve("");
}

async function readStdoutAndDrainStderr(
  proc: ReturnType<typeof Bun.spawn>
): Promise<{ stdout: string; timedOut: boolean }> {
  const stdoutPromise = streamToText(proc.stdout);
  const stderrPromise = streamToText(proc.stderr);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timeoutId = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // Process may have already exited.
      }
      resolve("timeout");
    }, SHELL_DETECTION_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([
      Promise.all([stdoutPromise, stderrPromise, proc.exited]).then(([stdout]) => stdout),
      timeoutPromise,
    ]);

    return result === "timeout"
      ? { stdout: "", timedOut: true }
      : { stdout: result, timedOut: false };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Detect bash version on macOS/Linux
 */
async function detectBashVersion(): Promise<string | null> {
  try {
    const bashCheck = Bun.spawn({
      cmd: ["bash", "--version"],
      stdout: "pipe",
      stderr: "pipe",
    });

    const { stdout: output } = await readStdoutAndDrainStderr(bashCheck);

    if (bashCheck.exitCode === 0 && output.trim()) {
      // Extract version from "GNU bash, version 5.2.15(1)-release"
      const versionMatch = output.match(/version\s+([\d.]+)/i);
      return versionMatch?.[1] ?? output.split("\n")[0]?.trim() ?? null;
    }
  } catch {
    // bash not available or failed
  }

  return null;
}

/**
 * Detect zsh version on macOS/Linux
 */
async function detectZshVersion(): Promise<string | null> {
  try {
    const zshCheck = Bun.spawn({
      cmd: ["zsh", "--version"],
      stdout: "pipe",
      stderr: "pipe",
    });

    const { stdout: output } = await readStdoutAndDrainStderr(zshCheck);

    if (zshCheck.exitCode === 0 && output.trim()) {
      // Extract version from "zsh 5.9 (x86_64-apple-darwin23.0)"
      const versionMatch = output.match(/zsh\s+([\d.]+)/i);
      return versionMatch?.[1] ?? output.trim();
    }
  } catch {
    // zsh not available
  }

  return null;
}

/**
 * Detect fish shell version on macOS/Linux
 */
async function detectFishVersion(): Promise<string | null> {
  try {
    const fishCheck = Bun.spawn({
      cmd: ["fish", "--version"],
      stdout: "pipe",
      stderr: "pipe",
    });

    const { stdout: output } = await readStdoutAndDrainStderr(fishCheck);

    if (fishCheck.exitCode === 0 && output.trim()) {
      // Extract version from "fish, version 3.6.1"
      const versionMatch = output.match(/version\s+([\d.]+)/i);
      return versionMatch?.[1] ?? output.trim();
    }
  } catch {
    // fish not available
  }

  return null;
}

/**
 * Detect which Unix shell is active based on $SHELL environment variable
 */
function detectUnixShellType(shellPath: string): {
  type: "bash" | "zsh" | "fish" | "sh" | "unknown";
  name: string;
} {
  const lower = shellPath.toLowerCase();

  if (lower.includes("bash")) {
    return { type: "bash", name: "bash" };
  } else if (lower.includes("zsh")) {
    return { type: "zsh", name: "zsh" };
  } else if (lower.includes("fish")) {
    return { type: "fish", name: "fish" };
  } else if (lower.endsWith("/sh")) {
    return { type: "sh", name: "sh" };
  }

  return { type: "unknown", name: shellPath };
}

/**
 * Detect shell environment and capabilities (full cross-platform)
 */
export async function detectShellEnvironment(): Promise<ShellEnvironment> {
  cachedShellEnvironment ??= detectShellEnvironmentUncached();
  return cachedShellEnvironment;
}

async function detectShellEnvironmentUncached(): Promise<ShellEnvironment> {
  const platform =
    process.platform === "win32"
      ? "Windows"
      : process.platform === "darwin"
        ? "macOS"
        : "Linux";

  const recommendations: string[] = [];
  const tips: string[] = [];

  // ===== Windows Platform =====
  if (process.platform === "win32") {
    const detected = await detectWindowsCommandShell();
    const shellType = detected.type;
    const shell = detected.displayName;

    if (shellType === "powershell5") {
      recommendations.push(
        "PowerShell 5.x detected: Use ; instead of && to chain commands"
      );
      recommendations.push(
        "Consider installing PowerShell 7+ (pwsh) for && and || support"
      );
      tips.push("Commands return objects by default - pipe through | Out-String for text");
      tips.push("Use *>&1 to merge all output streams");
    } else if (shellType === "powershell7") {
      tips.push("PowerShell 7+ supports && and || operators");
      tips.push("Commands still return objects - use | Out-String when needed");
    } else if (shellType === "cmd") {
      tips.push("cmd.exe supports && and || operators");
      tips.push("Use Windows command syntax for shell commands");
    } else {
      tips.push("Git Bash supports POSIX shell syntax with && and || operators");
      tips.push("Use bash/POSIX syntax for shell commands");
    }

    return {
      platform,
      shell,
      ...(detected.version ? { shellVersion: detected.version } : {}),
      shellType,
      commandShell: shell,
      commandShellType: shellType,
      supportsChainedCommands: detected.supportsChainedCommands,
      commandSeparator: detected.commandSeparator,
      recommendations,
      tips,
    };
  }

  // ===== macOS / Linux Platform =====
  const shellPath = process.env["SHELL"] || "/bin/bash";
  const { type: shellType, name: shellName } = detectUnixShellType(shellPath);

  let version: string | undefined;
  let detectedShell = shellName;

  // Try to detect version for known shells
  switch (shellType) {
    case "bash": {
      const bashVer = await detectBashVersion();
      if (bashVer) {
        version = bashVer;
        detectedShell = `bash ${bashVer}`;
      }
      tips.push("bash supports && and || for conditional chaining");
      tips.push("Use set -e to exit on first error in scripts");
      break;
    }

    case "zsh": {
      const zshVer = await detectZshVersion();
      if (zshVer) {
        version = zshVer;
        detectedShell = `zsh ${zshVer}`;
      }
      tips.push("zsh supports && and || for conditional chaining");
      tips.push("zsh has enhanced globbing - use setopt for advanced patterns");
      tips.push("impulse command execution still uses bash -lc; use POSIX/bash syntax in bash tools");
      if (platform === "macOS") {
        tips.push("zsh is the default shell on macOS 10.15+ (Catalina and later)");
      }
      break;
    }

    case "fish": {
      const fishVer = await detectFishVersion();
      if (fishVer) {
        version = fishVer;
        detectedShell = `fish ${fishVer}`;
      }
      tips.push("fish login shell detected");
      tips.push("impulse command execution still uses bash -lc; use POSIX/bash syntax in bash tools");
      break;
    }

    case "sh": {
      tips.push("sh (POSIX shell) - basic feature set only");
      tips.push("Avoid bash-specific features (arrays, [[, etc.)");
      break;
    }

    default: {
      recommendations.push(`Unknown shell: ${shellPath} - assuming POSIX compatibility`);
      break;
    }
  }

  // Add platform-specific tips
  if (platform === "macOS") {
    tips.push("Use 'brew' for package management on macOS");
  } else if (platform === "Linux") {
    tips.push("Common package managers: apt (Debian/Ubuntu), dnf (Fedora), pacman (Arch)");
  }

  const bashVersion = shellType === "bash" ? version : await detectBashVersion();
  const commandShell = bashVersion ? `bash ${bashVersion}` : "bash";

  return {
    platform,
    shell: detectedShell,
    ...(version ? { shellVersion: version } : {}),
    shellType,
    commandShell,
    commandShellType: "bash",
    supportsChainedCommands: true,
    commandSeparator: "&&",
    recommendations,
    tips,
  };
}

/**
 * Format shell environment info for display (human-readable)
 */
export function formatShellEnvironment(env: ShellEnvironment): string {
  const lines: string[] = [];

  lines.push(`Platform: ${env.platform}`);
  lines.push(`Login shell: ${env.shell}`);
  lines.push(`Command shell: ${env.commandShell}`);

  if (env.shellVersion) {
    lines.push(`Login shell version: ${env.shellVersion}`);
  }

  lines.push(`Chaining: ${env.supportsChainedCommands ? env.commandSeparator : "not supported"}`);

  if (env.tips.length > 0) {
    lines.push("");
    lines.push("Shell Tips:");
    for (const tip of env.tips) {
      lines.push(`  • ${tip}`);
    }
  }

  if (env.recommendations.length > 0) {
    lines.push("");
    lines.push("Recommendations:");
    for (const rec of env.recommendations) {
      lines.push(`  ⚠ ${rec}`);
    }
  }

  return lines.join("\n");
}

/**
 * Generate shell-aware system prompt context
 */
export function generateShellContext(env: ShellEnvironment): string {
  const parts: string[] = [];
  const shellType = env.commandShellType;

  parts.push(`Operating system: ${env.platform}`);
  if (env.platform === "Windows") {
    parts.push(`Shell: ${env.commandShell} (${env.commandShellType})`);
  } else {
    parts.push(`Login shell: ${env.shell} (${env.shellType})`);
    parts.push(`Command shell: ${env.commandShell} (${env.commandShellType}, via bash -lc)`);
  }

  // Add platform-specific command guidance
  parts.push("");
  parts.push("IMPORTANT: Shell command syntax:");

  switch (shellType) {
    case "powershell5":
      parts.push("- Use ; (semicolon) to chain commands, NOT &&");
      parts.push("- && and || operators require PowerShell 7+");
      parts.push("- Commands return objects - pipe through | Out-String when text is needed");
      parts.push("- Use *>&1 to merge all output streams when needed");
      parts.push("- POSIX commands are auto-translated to PowerShell equivalents");
      break;

    case "powershell7":
      parts.push("- Supports && (and) and || (or) operators");
      parts.push("- Commands return objects - pipe through | Out-String when text is needed");
      parts.push("- Use *>&1 to merge all output streams when needed");
      parts.push("- POSIX commands are auto-translated to PowerShell equivalents");
      break;

    case "cmd":
      parts.push("- Use Windows cmd.exe syntax");
      parts.push("- Supports && (and), || (or), and & (unconditional) operators");
      parts.push("- POSIX-to-PowerShell translation is not applied in cmd.exe");
      break;

    case "git-bash":
      parts.push("- Use bash/POSIX syntax");
      parts.push("- Supports && (and), || (or), and ; (unconditional) operators");
      parts.push("- POSIX-to-PowerShell translation is not applied in Git Bash");
      break;

    case "wsl":
      parts.push("- Commands run inside WSL (Windows Subsystem for Linux) — use POSIX/bash syntax");
      parts.push("- Supports && (and), || (or), and ; (unconditional) operators");
      parts.push("- Windows paths are accessible under /mnt/ (e.g. C:\\Users → /mnt/c/Users)");
      parts.push("- Linux-native package managers (apt, etc.) are available inside WSL");
      parts.push("- Working directory is auto-translated from Windows path to /mnt/... form");
      break;

    case "bash":
      parts.push("- Use && to chain commands (runs next only if previous succeeds)");
      parts.push("- Use || for OR logic (runs next only if previous fails)");
      parts.push("- Use ; to run commands unconditionally");
      parts.push("- The bash tool executes commands with bash -lc on macOS/Linux");
      parts.push("- Standard POSIX commands available (ls, grep, cat, etc.)");
      break;

    default:
      parts.push("- Assuming POSIX-compatible shell");
      parts.push("- Use && and || for conditional chaining");
      break;
  }

  return parts.join("\n");
}
import { detectWindowsCommandShell, type WindowsCommandShellType } from "./windows-shell.js";

// ---------------------------------------------------------------------------
// Tool-availability probe (#118 item 3 / #115 shared)
// ---------------------------------------------------------------------------

export interface ToolAvailability {
  available: string[];   // "git 2.41.0" style (version when probed, name-only as fallback)
  unavailable: string[];
}

let cachedToolAvailability: Promise<ToolAvailability> | undefined;

const COMMON_TOOLS = ["git", "node", "npm", "bun", "python", "docker", "rg", "jq", "curl"];
const WINDOWS_EXTRA = ["wsl"];

async function probeOneTool(name: string): Promise<string | null> {
  try {
    const found = Bun.which(name);
    if (!found) return null;
    // Probe version with a quick, per-check 1.5s timeout
    const proc = Bun.spawn({
      cmd: [name, "--version"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = new Promise<"timeout">((r) => setTimeout(() => { try { proc.kill(); } catch { /* */ } r("timeout"); }, 1500));
    const result = await Promise.race([
      new Response(proc.stdout).text().then((t) => t.trim().split("\n")[0] ?? ""),
      timer,
    ]);
    if (result === "timeout" || !result) return name;
    // Keep only the first 60 chars to avoid huge version strings
    return `${name} (${result.slice(0, 60)})`;
  } catch {
    return null;
  }
}

export async function probeToolAvailability(): Promise<ToolAvailability> {
  cachedToolAvailability ??= probeToolAvailabilityUncached();
  return cachedToolAvailability;
}

async function probeToolAvailabilityUncached(): Promise<ToolAvailability> {
  const tools = process.platform === "win32"
    ? [...COMMON_TOOLS, ...WINDOWS_EXTRA]
    : COMMON_TOOLS;

  const results = await Promise.all(tools.map(probeOneTool));

  const available: string[] = [];
  const unavailable: string[] = [];
  for (let i = 0; i < tools.length; i++) {
    if (results[i] !== null) available.push(results[i]!);
    else unavailable.push(tools[i]!);
  }
  return { available, unavailable };
}

export function formatToolAvailabilityBlock(avail: ToolAvailability): string {
  const lines: string[] = ["## Available CLI tools"];
  if (avail.available.length > 0) {
    lines.push(`Available: ${avail.available.join(", ")}`);
  }
  if (avail.unavailable.length > 0) {
    lines.push(`Not found: ${avail.unavailable.join(", ")}`);
  }
  return lines.join("\n");
}
