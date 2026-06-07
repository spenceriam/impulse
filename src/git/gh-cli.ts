import { execSync } from "child_process";

export interface GhCliStatus {
  installed: boolean;
  authenticated: boolean;
  account?: string;
}

let cachedAt = 0;
let cachedStatus: GhCliStatus | null = null;

const CACHE_MS = 60_000;

function runQuiet(command: string, timeoutMs = 3000): { ok: boolean; stdout: string } {
  try {
    const stdout = execSync(command, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      encoding: "utf-8",
    });
    return { ok: true, stdout: stdout.toString().trim() };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    const stdout = (e.stdout?.toString() ?? e.stderr?.toString() ?? "").trim();
    return { ok: false, stdout };
  }
}

/**
 * Probe whether GitHub CLI is installed and authenticated.
 */
export function probeGhCli(force = false): GhCliStatus {
  const now = Date.now();
  if (!force && cachedStatus && now - cachedAt < CACHE_MS) {
    return cachedStatus;
  }

  const version = runQuiet("gh --version", 2000);
  if (!version.ok) {
    cachedStatus = { installed: false, authenticated: false };
    cachedAt = now;
    return cachedStatus;
  }

  const auth = runQuiet("gh auth status -h github.com 2>&1", 4000);
  if (!auth.ok) {
    cachedStatus = { installed: true, authenticated: false };
    cachedAt = now;
    return cachedStatus;
  }

  const accountMatch = auth.stdout.match(/Logged in to github\.com account (\S+)/i);
  const status: GhCliStatus = {
    installed: true,
    authenticated: true,
    ...(accountMatch?.[1] !== undefined ? { account: accountMatch[1] } : {}),
  };
  cachedStatus = status;
  cachedAt = now;
  return status;
}

export function clearGhCliCache(): void {
  cachedAt = 0;
  cachedStatus = null;
}

export function formatGhCliPromptBlock(status: GhCliStatus): string {
  const lines = [
    "## GitHub CLI",
    "",
    `installed: ${status.installed ? "yes" : "no"}`,
    `authenticated: ${status.authenticated ? "yes" : "no"}`,
  ];

  if (status.installed && status.authenticated && status.account) {
    lines.push(`account: ${status.account}`);
    lines.push("");
    lines.push("Use the `github_issue` tool to read issues from this repo (requires gh).");
  } else if (status.installed && !status.authenticated) {
    lines.push("");
    lines.push("Run `gh auth login` to enable `github_issue`. Until then use `web_fetch` on the canonical issue URL from Repository (git).");
  } else {
    lines.push("");
    lines.push("Install GitHub CLI (https://cli.github.com/) to enable `github_issue`. Until then use `web_fetch` on the canonical issue URL from Repository (git).");
  }

  return lines.join("\n");
}