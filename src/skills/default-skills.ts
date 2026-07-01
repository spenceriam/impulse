/**
 * Out-of-box default skills (#117) — scaffolds a bundled set of skills into
 * .agents/skills/ on first run, without clobbering user edits or resurrecting
 * skills the user deliberately removed.
 */

import { existsSync, cpSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { writeJsonAtomic } from "../util/atomic-write.js";

const MARKER_PATH = ".impulse/default-skills.json";
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

function parseFrontmatterField(content: string, field: string): string | undefined {
  const fm = content.match(FRONTMATTER_RE)?.[1];
  if (!fm) return undefined;
  const line = fm.split(/\r?\n/).find((l) => l.startsWith(`${field}:`));
  if (!line) return undefined;
  return line.slice(field.length + 1).trim().replace(/^["']|["']$/g, "");
}

function getDefaultSkillsDir(): string | null {
  const override = process.env["IMPULSE_DEFAULT_SKILLS_DIR"];
  if (override && existsSync(override)) return override;

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Dev: src/skills -> ../../skills/defaults
    join(here, "..", "..", "skills", "defaults"),
    // Dist: dist -> skills-defaults
    join(here, "skills-defaults"),
    // Fallback: src -> ../skills-defaults
    join(here, "..", "skills-defaults"),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

type ScaffoldMarker = Record<string, string>;

function readMarker(cwd: string): ScaffoldMarker {
  const markerPath = join(cwd, MARKER_PATH);
  if (!existsSync(markerPath)) return {};
  try {
    return JSON.parse(readFileSync(markerPath, "utf-8")) as ScaffoldMarker;
  } catch {
    return {};
  }
}

/**
 * Scaffold bundled default skills into .agents/skills/ on first run.
 * - Never installed before: copy in, record its version.
 * - Already scaffolded and present, bundled version newer, not user-edited: refresh it.
 * - Already scaffolded and present, but edited by the user: never overwritten.
 * - Already scaffolded but the user deleted it: never resurrected.
 */
export async function ensureDefaultSkills(cwd: string): Promise<void> {
  const defaultsDir = getDefaultSkillsDir();
  if (!defaultsDir) return;

  let defaultSlugs: string[];
  try {
    defaultSlugs = readdirSync(defaultsDir).filter((name) =>
      statSync(join(defaultsDir, name)).isDirectory()
    );
  } catch {
    return;
  }

  const marker = readMarker(cwd);
  let markerChanged = false;
  const skillsRoot = join(cwd, ".agents", "skills");

  for (const slug of defaultSlugs) {
    const bundledSkillMd = join(defaultsDir, slug, "SKILL.md");
    if (!existsSync(bundledSkillMd)) continue;

    let bundledContent: string;
    try {
      bundledContent = readFileSync(bundledSkillMd, "utf-8");
    } catch {
      continue;
    }
    const bundledVersion = parseFrontmatterField(bundledContent, "version") ?? "0.0.0";

    const installedDir = join(skillsRoot, slug);
    const previouslyScaffolded = slug in marker;

    if (!previouslyScaffolded) {
      if (existsSync(installedDir)) continue; // user already has a same-named skill; don't touch it
      mkdirSync(skillsRoot, { recursive: true });
      cpSync(join(defaultsDir, slug), installedDir, { recursive: true });
      marker[slug] = bundledVersion;
      markerChanged = true;
      continue;
    }

    if (!existsSync(installedDir)) {
      // Previously scaffolded, now missing — the user deleted it. Leave it gone.
      continue;
    }

    const installedSkillMd = join(installedDir, "SKILL.md");
    let installedContent = "";
    try {
      installedContent = readFileSync(installedSkillMd, "utf-8");
    } catch {
      continue;
    }
    const edited = parseFrontmatterField(installedContent, "edited") === "true";
    if (edited) continue;

    if (bundledVersion !== marker[slug]) {
      cpSync(join(defaultsDir, slug), installedDir, { recursive: true });
      marker[slug] = bundledVersion;
      markerChanged = true;
    }
  }

  if (markerChanged) {
    await writeJsonAtomic(join(cwd, MARKER_PATH), marker);
  }
}
