import { existsSync } from "fs";
import { join } from "path";

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