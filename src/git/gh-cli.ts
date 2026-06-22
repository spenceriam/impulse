import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

export interface GhCliStatus {
  installed: boolean;
  authenticated: boolean;
  account?: string;
}

let cachedAt = 0;
let cachedStatus: GhCliStatus | null = null;

const CACHE_MS = 60_000;

function executableCandidates(name: string, env: NodeJS.ProcessEnv = process.env): string[] {
  if (process.platform !== "win32") return [name];
  const ext = path.extname(name);
  if (ext) return [name];
  const pathext = env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD";
  return pathext
    .split(";")
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => `${name}${e.toLowerCase()}`);
}

export function resolveGhCliPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env["GH_CLI_PATH"]?.trim();
  if (override) {
    return fs.existsSync(override) ? override : null;
  }

  const pathValue = env["PATH"] ?? "";
  const dirs = pathValue.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const candidate of executableCandidates("gh", env)) {
      const fullPath = path.join(dir, candidate);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  }

  return null;
}

function runQuiet(
  executable: string,
  args: string[],
  timeoutMs = 3000
): { ok: boolean; stdout: string } {
  try {
    const stdout = execFileSync(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      encoding: "utf-8",
      windowsHide: true,
    });
    return { ok: true, stdout: stdout.toString().trim() };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string };
    const out =
      typeof e.stdout === "string" ? e.stdout : e.stdout?.toString();
    const errOut =
      typeof e.stderr === "string" ? e.stderr : e.stderr?.toString();
    const stdout = [out, errOut].filter(Boolean).join("\n").trim();
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

  const ghPath = resolveGhCliPath();
  if (!ghPath) {
    cachedStatus = { installed: false, authenticated: false };
    cachedAt = now;
    return cachedStatus;
  }

  const version = runQuiet(ghPath, ["--version"], 2000);
  if (!version.ok) {
    cachedStatus = { installed: false, authenticated: false };
    cachedAt = now;
    return cachedStatus;
  }

  const auth = runQuiet(ghPath, ["auth", "status", "-h", "github.com"], 4000);
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
