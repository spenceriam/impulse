import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { probeGhCli } from "../git/gh-cli.js";
import {
  issueUrlForNumber,
  parseGitHubOwnerRepo,
  resolveRepoContext,
  type RepoContext,
} from "../git/repo-context.js";

const DESCRIPTION = `Read a GitHub issue via GitHub CLI (gh). Requires gh installed and authenticated.

Does not use web_fetch. If gh is unavailable, the tool returns the canonical issue URL — use web_fetch on that URL instead.

For "issue #N" in the current workspace, omit owner/repo (uses Repository context).`;

const GithubIssueSchema = z.object({
  number: z.number().int().positive().describe("Issue number"),
  owner: z.string().optional().describe("Repository owner (defaults to workspace repo)"),
  repo: z.string().optional().describe("Repository name (defaults to workspace repo)"),
  url: z
    .string()
    .optional()
    .describe("Full GitHub issue URL (overrides number/owner/repo when parseable)"),
});

type GithubIssueInput = z.infer<typeof GithubIssueSchema>;

interface GhIssueJson {
  title?: string;
  body?: string;
  state?: string;
  url?: string;
  labels?: Array<{ name?: string }>;
  comments?: Array<{ author?: { login?: string }; body?: string }>;
}

function parseIssueUrl(url: string): { owner: string; repo: string; number: number } | null {
  try {
    const u = new URL(url);
    if (u.hostname.replace(/^www\./, "") !== "github.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    // owner/repo/issues/N
    if (parts.length >= 4 && parts[2] === "issues") {
      const num = parseInt(parts[3]!, 10);
      if (!Number.isNaN(num) && num > 0) {
        return { owner: parts[0]!, repo: parts[1]!, number: num };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function resolveTarget(input: GithubIssueInput, ctx: RepoContext | null): {
  owner: string;
  repo: string;
  number: number;
} | { error: string } {
  if (input.url) {
    const fromUrl = parseIssueUrl(input.url);
    if (fromUrl) return fromUrl;
    const parsed = parseGitHubOwnerRepo(input.url);
    if (parsed && input.number) {
      return { ...parsed, number: input.number };
    }
    return { error: `Could not parse GitHub issue URL: ${input.url}` };
  }

  const number = input.number;
  if (input.owner && input.repo) {
    return { owner: input.owner, repo: input.repo, number };
  }

  if (ctx) {
    return { owner: ctx.owner, repo: ctx.repo, number };
  }

  return {
    error:
      "No GitHub repository detected for this workspace. Provide owner/repo, a full issue URL, or use the question tool to ask which repository.",
  };
}

function formatIssueOutput(
  data: GhIssueJson,
  fullName: string,
  number: number
): string {
  const labels =
    data.labels?.map((l) => l.name).filter(Boolean).join(", ") || "(none)";
  const comments = data.comments ?? [];
  const commentBlock =
    comments.length === 0
      ? "(no comments)"
      : comments
          .slice(0, 5)
          .map(
            (c, i) =>
              `### Comment ${i + 1}${c.author?.login ? ` (@${c.author.login})` : ""}\n${(c.body ?? "").slice(0, 2000)}`
          )
          .join("\n\n") +
        (comments.length > 5 ? `\n\n... and ${comments.length - 5} more comments` : "");

  return [
    `# ${fullName}#${number}: ${data.title ?? "(no title)"}`,
    "",
    `**State:** ${data.state ?? "unknown"}`,
    `**URL:** ${data.url ?? ""}`,
    `**Labels:** ${labels}`,
    "",
    "## Body",
    data.body ?? "(empty)",
    "",
    "## Comments (preview)",
    commentBlock,
  ].join("\n");
}

export const githubIssueTool: Tool<GithubIssueInput> = Tool.define(
  "github_issue",
  DESCRIPTION,
  GithubIssueSchema,
  async (input: GithubIssueInput): Promise<ToolResult> => {
    const gh = probeGhCli();
    const ctx = resolveRepoContext();
    const target = resolveTarget(input, ctx);

    if ("error" in target) {
      return { success: false, output: target.error };
    }

    const { owner, repo, number } = target;
    const fullName = `${owner}/${repo}`;
    const canonicalUrl = issueUrlForNumber(
      ctx ?? {
        owner,
        repo,
        fullName,
        webUrl: `https://github.com/${fullName}`,
        issueUrlTemplate: `https://github.com/${fullName}/issues/{number}`,
        source: "git-remote",
      },
      number
    );

    if (!gh.installed) {
      return {
        success: false,
        output: [
          "GitHub CLI (gh) is not installed.",
          `Canonical issue URL: ${canonicalUrl}`,
          "Install gh (https://cli.github.com/) or use web_fetch on that URL.",
        ].join("\n"),
      };
    }

    if (!gh.authenticated) {
      return {
        success: false,
        output: [
          "GitHub CLI is not authenticated. Run: gh auth login",
          `Canonical issue URL: ${canonicalUrl}`,
          "Or use web_fetch on that URL.",
        ].join("\n"),
      };
    }

    const fields = "title,body,state,url,labels,comments";
    const proc = Bun.spawn(
      ["gh", "issue", "view", String(number), "-R", fullName, "--json", fields],
      { stdout: "pipe", stderr: "pipe", cwd: process.cwd() }
    );

    const timedOut = await Promise.race([
      proc.exited.then(() => false),
      Bun.sleep(30_000).then(() => true),
    ]);

    if (timedOut) {
      proc.kill();
      return { success: false, output: `gh issue view timed out for ${fullName}#${number}` };
    }

    const exitCode = proc.exitCode ?? 1;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (exitCode !== 0) {
      return {
        success: false,
        output: [
          `gh issue view failed for ${fullName}#${number} (exit ${exitCode})`,
          stderr || stdout,
          `Canonical URL: ${canonicalUrl}`,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }

    try {
      const data = JSON.parse(stdout) as GhIssueJson;
      return {
        success: true,
        output: formatIssueOutput(data, fullName, number),
        metadata: {
          type: "github_issue",
          owner,
          repo,
          number,
          url: data.url ?? canonicalUrl,
        },
      };
    } catch {
      return {
        success: false,
        output: `Failed to parse gh JSON output for ${fullName}#${number}\n${stdout}`,
      };
    }
  },
  { timeout: 35_000 }
);