/**
 * Skill surface catalog (#138).
 *
 * One entry point (`/skill`) instead of every installed skill registering its
 * own top-level slash command. Splits the bundled set into a small `basic`
 * group (scaffolded on first run) and a `curated` group (discoverable, not
 * scaffolded), and merges the installed skills on disk with it.
 */

export interface SkillCatalogEntry {
  slug: string;
  description?: string;
  command?: string;
  /** Scaffolded on first run. */
  basic: boolean;
  installed: boolean;
}

/** Bundled skills scaffolded on a fresh install. Everything else curated. */
export const BASIC_SKILLS = new Set(["implement", "tdd", "code-review", "diagnosing-bugs"]);

export function isBasicSkill(slug: string): boolean {
  return BASIC_SKILLS.has(slug);
}

/**
 * Merge what is installed on disk with the bundled catalog.
 *
 * Installed wins for description; a bundled skill that is not installed is
 * `available` (curated), never silently re-scaffolded.
 */
export function buildSkillCatalog(
  installed: Array<{ slug: string; description?: string; command?: string }>,
  bundled: Array<{ slug: string; description?: string }>
): SkillCatalogEntry[] {
  const bySlug = new Map<string, SkillCatalogEntry>();

  for (const skill of bundled) {
    bySlug.set(skill.slug, {
      slug: skill.slug,
      ...(skill.description ? { description: skill.description } : {}),
      basic: isBasicSkill(skill.slug),
      installed: false,
    });
  }
  for (const skill of installed) {
    const prev = bySlug.get(skill.slug);
    const description = skill.description ?? prev?.description;
    const command = skill.command ?? prev?.command;
    bySlug.set(skill.slug, {
      slug: skill.slug,
      ...(description ? { description } : {}),
      ...(command ? { command } : {}),
      basic: isBasicSkill(skill.slug),
      installed: true,
    });
  }

  return [...bySlug.values()].sort((a, b) => {
    // Installed first, then alphabetical.
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    return a.slug.localeCompare(b.slug);
  });
}

export function installedEntries(catalog: SkillCatalogEntry[]): SkillCatalogEntry[] {
  return catalog.filter((e) => e.installed);
}

/** Curated skills that are bundled but not installed (the "Available" list). */
export function availableEntries(catalog: SkillCatalogEntry[]): SkillCatalogEntry[] {
  return catalog.filter((e) => !e.installed && !e.basic);
}

/** Parse `/skill <sub> …`: a slug run, or a management subcommand. */
export function parseSkillArg(arg: string): {
  action: "run" | "new" | "remove" | "modify" | "install" | "list";
  slug: string;
} {
  const parts = arg.trim().split(/\s+/).filter(Boolean);
  const sub = (parts[0] ?? "").toLowerCase();
  const rest = parts.slice(1).join(" ");
  if (sub === "new") return { action: "new", slug: "" };
  if (sub === "remove" || sub === "rm") return { action: "remove", slug: rest };
  if (sub === "modify" || sub === "edit") return { action: "modify", slug: rest };
  if (sub === "install") return { action: "install", slug: rest };
  if (!sub) return { action: "list", slug: "" };
  // `/skill tdd` runs that skill.
  return { action: "run", slug: parts.join(" ") };
}
