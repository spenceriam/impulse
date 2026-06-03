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
  shellType: "powershell5" | "powershell7" | "bash" | "zsh" | "fish" | "sh" | "unknown";
  /** Shell actually used by the bash tool for command execution. */
  commandShell: string;
  commandShellType: "powershell5" | "powershell7" | "bash";
  supportsChainedCommands: boolean;
  commandSeparator: string; // ; or && depending on shell
  recommendations: string[];
  tips: string[];
}

let cachedShellEnvironment: Promise<ShellEnvironment> | undefined;

function streamToText(
  stream: ReadableStream<Uint8Array> | number | null | undefined
): Promise<string> {
  return stream instanceof ReadableStream ? new Response(stream).text() : Promise.resolve("");
}

async function readStdoutAndDrainStderr(proc: ReturnType<typeof Bun.spawn>): Promise<string> {
  const stdoutPromise = streamToText(proc.stdout);
  const stderrPromise = streamToText(proc.stderr);
  const [stdout] = await Promise.all([stdoutPromise, stderrPromise, proc.exited]);
  return stdout;
}

/**
 * Detect PowerShell version on Windows
 */
async function detectPowerShellVersion(): Promise<{ version: string; isPwsh7: boolean }> {
  if (process.platform !== "win32") {
    return { version: "N/A", isPwsh7: false };
  }

  try {
    // Try to detect PowerShell 7 (pwsh)
    const pwsh7Check = Bun.spawn({
      cmd: ["pwsh", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
      stdout: "pipe",
      stderr: "pipe",
    });

    const pwsh7Output = await readStdoutAndDrainStderr(pwsh7Check);

    if (pwsh7Check.exitCode === 0 && pwsh7Output.trim()) {
      return { version: pwsh7Output.trim(), isPwsh7: true };
    }
  } catch {
    // pwsh not available, fall back to Windows PowerShell
  }

  try {
    // Fall back to Windows PowerShell 5.x
    const ps5Check = Bun.spawn({
      cmd: [
        "powershell.exe",
        "-NoProfile",
        "-Command",
        "$PSVersionTable.PSVersion.ToString()",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });

    const ps5Output = await readStdoutAndDrainStderr(ps5Check);

    if (ps5Check.exitCode === 0 && ps5Output.trim()) {
      return { version: ps5Output.trim(), isPwsh7: false };
    }
  } catch {
    // Could not detect
  }

  return { version: "Unknown", isPwsh7: false };
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

    const output = await readStdoutAndDrainStderr(bashCheck);

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

    const output = await readStdoutAndDrainStderr(zshCheck);

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

    const output = await readStdoutAndDrainStderr(fishCheck);

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
    const { version, isPwsh7 } = await detectPowerShellVersion();
    const shellType = isPwsh7 ? "powershell7" : "powershell5";
    const shell = isPwsh7 ? "PowerShell 7.x (pwsh)" : "Windows PowerShell 5.x";

    if (!isPwsh7) {
      recommendations.push(
        "PowerShell 5.x detected: Use ; instead of && to chain commands"
      );
      recommendations.push(
        "Consider installing PowerShell 7+ (pwsh) for && and || support"
      );
      tips.push("Commands return objects by default - pipe through | Out-String for text");
      tips.push("Use *>&1 to merge all output streams");
    } else {
      tips.push("PowerShell 7+ supports && and || operators");
      tips.push("Commands still return objects - use | Out-String when needed");
    }

    return {
      platform,
      shell,
      shellVersion: version,
      shellType,
      commandShell: shell,
      commandShellType: shellType,
      supportsChainedCommands: isPwsh7,
      commandSeparator: isPwsh7 ? "&&" : ";",
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
