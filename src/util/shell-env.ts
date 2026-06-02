/**
 * Shell Environment Detection
 * 
 * Detects host shell capabilities and environment information for
 * better cross-platform command execution and agent guidance.
 */

export interface ShellEnvironment {
  platform: "Windows" | "macOS" | "Linux";
  shell: string;
  shellVersion?: string;
  isPowerShell5: boolean;
  isPowerShell7: boolean;
  supportsChainedCommands: boolean;
  recommendations: string[];
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

    const pwsh7Output = await new Response(pwsh7Check.stdout).text();
    await pwsh7Check.exited;

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

    const ps5Output = await new Response(ps5Check.stdout).text();
    await ps5Check.exited;

    if (ps5Check.exitCode === 0 && ps5Output.trim()) {
      return { version: ps5Output.trim(), isPwsh7: false };
    }
  } catch {
    // Could not detect
  }

  return { version: "Unknown", isPwsh7: false };
}

/**
 * Detect shell environment and capabilities
 */
export async function detectShellEnvironment(): Promise<ShellEnvironment> {
  const platform =
    process.platform === "win32"
      ? "Windows"
      : process.platform === "darwin"
        ? "macOS"
        : "Linux";

  const recommendations: string[] = [];

  if (process.platform === "win32") {
    const { version, isPwsh7 } = await detectPowerShellVersion();
    const shell = isPwsh7 ? "PowerShell 7.x (pwsh)" : "Windows PowerShell 5.x";
    const isPowerShell5 = !isPwsh7;

    if (isPowerShell5) {
      recommendations.push(
        "PowerShell 5.x detected: Use ; instead of && to chain commands"
      );
      recommendations.push(
        "Consider installing PowerShell 7+ (pwsh) for && and || support"
      );
    }

    return {
      platform,
      shell,
      shellVersion: version,
      isPowerShell5,
      isPowerShell7: isPwsh7,
      supportsChainedCommands: isPwsh7,
      recommendations,
    };
  }

  // macOS or Linux
  const shell = process.env["SHELL"] || "bash";
  return {
    platform,
    shell,
    isPowerShell5: false,
    isPowerShell7: false,
    supportsChainedCommands: true,
    recommendations: [],
  };
}

/**
 * Format shell environment info for display
 */
export function formatShellEnvironment(env: ShellEnvironment): string {
  const lines: string[] = [];

  lines.push(`Platform: ${env.platform}`);
  lines.push(`Shell: ${env.shell}`);
  
  if (env.shellVersion) {
    lines.push(`Version: ${env.shellVersion}`);
  }

  if (env.recommendations.length > 0) {
    lines.push("");
    lines.push("Tips:");
    for (const rec of env.recommendations) {
      lines.push(`  - ${rec}`);
    }
  }

  return lines.join("\n");
}

/**
 * Generate shell-aware system prompt context
 */
export function generateShellContext(env: ShellEnvironment): string {
  const parts: string[] = [];

  parts.push(`Operating system: ${env.platform}`);
  parts.push(`Shell: ${env.shell}`);

  if (env.isPowerShell5) {
    parts.push("");
    parts.push("IMPORTANT: PowerShell 5.x command syntax:");
    parts.push("- Use ; (semicolon) to chain commands, NOT &&");
    parts.push("- && and || operators require PowerShell 7+");
    parts.push("- Commands may return objects, not text - use | Out-String for text output");
    parts.push("- Use *>&1 to merge all output streams (stdout + stderr)");
  } else if (env.isPowerShell7) {
    parts.push("");
    parts.push("PowerShell 7+ detected - supports && and || operators");
  }

  return parts.join("\n");
}
