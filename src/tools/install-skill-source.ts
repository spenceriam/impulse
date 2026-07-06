import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

export interface InstalledSkillMeta {
  slug: string;
  name: string;
  description?: string;
  /** Slash command this skill registers (without leading /), e.g. "grill" */
  command?: string;
  /** True when the file was edited by the user; prevents npm reinstall clobber */
  edited?: boolean;
  path: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

function parseSimpleYaml(block: string): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    const raw = m[2]!.trim().replace(/^["']|["']$/g, "");
    if (raw === "true") out[key] = true;
    else if (raw === "false") out[key] = false;
    else out[key] = raw;
  }
  return out;
}

/**
 * List all skills installed in this project's .agents/skills/ directory.
 */
export function listInstalledSkills(cwd: string): InstalledSkillMeta[] {
  const skillsDir = join(cwd, ".agents", "skills");
  if (!existsSync(skillsDir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(skillsDir);
  } catch {
    return [];
  }
  const result: InstalledSkillMeta[] = [];
  for (const slug of entries) {
    const skillMdPath = join(skillsDir, slug, "SKILL.md");
    if (!existsSync(skillMdPath)) continue;
    let content = "";
    try {
      content = readFileSync(skillMdPath, "utf-8");
    } catch {
      continue;
    }
    const fm = content.match(FRONTMATTER_RE)?.[1];
    const parsed = fm ? parseSimpleYaml(fm) : {};
    result.push({
      slug,
      name: (parsed["name"] as string | undefined) ?? slug,
      ...(parsed["description"] ? { description: parsed["description"] as string } : {}),
      ...(parsed["command"] ? { command: parsed["command"] as string } : {}),
      ...(parsed["edited"] ? { edited: true } : {}),
      path: skillMdPath,
    });
  }
  return result;
}

/** owner/repo only — `skills add` with -y installs every skill in the repo. */
const REPO_ONLY_PATTERN = /^[\w.-]+\/[\w.-]+$/;

export type NormalizedSkillSource = {
  source: string;
  skillSlug: string;
};

export function normalizeSkillSource(raw: string): NormalizedSkillSource | { error: string } {
  let source = raw.trim().replace(/\/+$/, "");

  const treeMatch = source.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/[^/]+\/(.+)$/i
  );
  if (treeMatch) {
    source = `${treeMatch[1]}/${treeMatch[2]}/${treeMatch[3]}`;
  } else {
    const blobMatch = source.match(
      /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/[^/]+\/(.+)$/i
    );
    if (blobMatch) {
      source = `${blobMatch[1]}/${blobMatch[2]}/${blobMatch[3]}`;
    }
  }

  source = source.replace(/\.git$/, "");

  if (REPO_ONLY_PATTERN.test(source)) {
    return {
      error: [
        `Source "${source}" names a repository, not one skill.`,
        "With non-interactive install, that would install every skill in the repo.",
        `Use the full skill path instead, e.g. ${source}/skills/engineering/grill-with-docs`,
        "Or pass the GitHub tree URL to the skill folder.",
      ].join("\n"),
    };
  }

  const segments = source.split("/").filter(Boolean);
  if (segments.length < 3) {
    return {
      error: `Source must include owner/repo and a skill path (at least 3 segments). Got: ${source}`,
    };
  }

  const skillSlug = segments[segments.length - 1]!;
  return { source, skillSlug };
}

export function skillInstructionsPath(cwd: string, skillSlug: string): string {
  return join(cwd, ".agents", "skills", skillSlug, "SKILL.md");
}

export function isSkillInstalled(cwd: string, skillSlug: string): boolean {
  return existsSync(skillInstructionsPath(cwd, skillSlug));
}

export function formatSkillReadyMessage(skillSlug: string, instructionsPath: string): string {
  return [
    `Skill "${skillSlug}" is ready.`,
    `Instructions: ${instructionsPath}`,
    "Read SKILL.md and follow it.",
    "For interview/grill flows: use the question tool (one topic per call) — never ask in plain chat text.",
  ].join("\n");
}