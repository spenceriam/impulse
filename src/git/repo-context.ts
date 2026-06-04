import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";

export interface RepoContext {
  owner: string;
  repo: string;
  fullName: string;
  webUrl: string;
  issueUrlTemplate: string;
  source: "package.json" | "git-remote";
}

let cachedCwd: string | null = null;
let cachedContext: RepoContext | null | undefined;

/**
 * Parse a GitHub remote or repository URL into owner/repo.
 */
export function parseGitHubOwnerRepo(raw: string): { owner: string; repo: string } | null {
  const trimmed = raw.trim().replace(/\.git$/i, "");

  const sshMatch = trimmed.match(/^(?:git@|ssh:\/\/git@)github\.com[:/]([^/]+)\/([^/]+)$/i);
  if (sshMatch) {
    return { owner: sshMatch[1]!, repo: sshMatch[2]! };
  }

  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    if (url.hostname.replace(/^www\./, "") !== "github.com") {
      return null;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return { owner: parts[0]!, repo: parts[1]! };
    }
  } catch {
    // not a URL
  }

  return null;
}

function readPackageRepositoryUrl(cwd: string): string | null {
  const pkgPath = path.join(cwd, "package.json");
  if (!existsSync(pkgPath)) return null;

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      repository?: string | { url?: string; type?: string };
    };
    const repo = pkg.repository;
    if (typeof repo === "string") return repo;
    if (repo && typeof repo.url === "string") return repo.url;
  } catch {
    return null;
  }
  return null;
}

function readGitOriginUrl(cwd: string): string | null {
  try {
    execSync("git rev-parse --git-dir", { cwd, stdio: "pipe" });
  } catch {
    return null;
  }

  try {
    return execSync("git remote get-url origin", { cwd, stdio: "pipe" })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function buildContext(
  owner: string,
  repo: string,
  source: RepoContext["source"]
): RepoContext {
  const fullName = `${owner}/${repo}`;
  const webUrl = `https://github.com/${fullName}`;
  return {
    owner,
    repo,
    fullName,
    webUrl,
    issueUrlTemplate: `${webUrl}/issues/{number}`,
    source,
  };
}

export function issueUrlForNumber(ctx: RepoContext, issueNumber: number): string {
  return `${ctx.webUrl}/issues/${issueNumber}`;
}

/**
 * Resolve GitHub owner/repo for the workspace (package.json repository, then git origin).
 */
export function resolveRepoContext(cwd = process.cwd()): RepoContext | null {
  if (cachedCwd === cwd && cachedContext !== undefined) {
    return cachedContext;
  }

  cachedCwd = cwd;
  cachedContext = null;

  const fromPkg = readPackageRepositoryUrl(cwd);
  if (fromPkg) {
    const parsed = parseGitHubOwnerRepo(fromPkg);
    if (parsed) {
      cachedContext = buildContext(parsed.owner, parsed.repo, "package.json");
      return cachedContext;
    }
  }

  const fromGit = readGitOriginUrl(cwd);
  if (fromGit) {
    const parsed = parseGitHubOwnerRepo(fromGit);
    if (parsed) {
      cachedContext = buildContext(parsed.owner, parsed.repo, "git-remote");
      return cachedContext;
    }
  }

  return null;
}

/** Clear cache when cwd changes between sessions (tests). */
export function clearRepoContextCache(): void {
  cachedCwd = null;
  cachedContext = undefined;
}

export function formatRepoContextPromptBlock(ctx: RepoContext | null): string {
  if (!ctx) {
    return `
## Repository (git)

No GitHub repository detected for this workspace (not a git repo or origin is not github.com).
If the user mentions "issue #N" without a repo or URL, use the \`question\` tool to ask which repository — they can use **Type your own answer** for \`owner/repo\` or a full issue URL.
`.trim();
  }

  return `
## Repository (git)

Detected GitHub repo: **${ctx.fullName}** (from ${ctx.source})
Repo URL: ${ctx.webUrl}
Issue URL pattern: ${ctx.issueUrlTemplate}

When the user says "issue #N" or "#N" without naming another repo, they mean **this repository's** issue N.
Do not web_search for generic "github issue N". Prefer \`github_issue\` when GitHub CLI is available, else \`web_fetch\` on the canonical issue URL.
`.trim();
}