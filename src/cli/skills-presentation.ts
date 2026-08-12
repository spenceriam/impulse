import type { InstalledSkillMeta } from "../tools/install-skill-source.js";
import type { Mode } from "../constants.js";
import {
  applyOverlayDensity,
  type PresentationDensity,
} from "./presentation-density.js";
import {
  SelectableListOverlay,
  type SelectableListOverlayOptions,
  type SelectableListRow,
} from "./components/selectable-list-overlay.js";

class SkillMenuOverlay extends SelectableListOverlay {
  constructor(
    options: SelectableListOverlayOptions,
    private readonly density: PresentationDensity
  ) {
    super(options);
  }

  override render(width: number): string[] {
    return applyOverlayDensity(super.render(width), this.density);
  }
}

/** Map installed-skill metadata to selectable-list rows for the /skills overlay. */
export function buildSkillRows(skills: InstalledSkillMeta[]): SelectableListRow[] {
  return skills.map((skill) => ({
    id: skill.slug,
    label: skill.slug,
    ...(skill.description ? { secondary: skill.description } : {}),
  }));
}

export function buildSkillsMenuRows(
  skills: InstalledSkillMeta[],
  mode: Mode
): SelectableListRow[] {
  const rows = skills.length > 0
    ? buildSkillRows(skills)
    : [{
        id: "skills:empty",
        label: "No skills installed",
        secondary: mode === "AGENT"
          ? "Install one to add a reusable workflow"
          : "ASK can inspect skills; switch to AGENT to install one",
      }];
  if (mode === "AGENT") {
    rows.push({ id: "skills:install", label: "Install skill…" });
  }
  return rows;
}

export function buildSkillActionRows(
  _skill: InstalledSkillMeta,
  mode: Mode
): SelectableListRow[] {
  return [
    { id: "use", label: "Use skill" },
    { id: "inspect", label: "Inspect instructions" },
    ...(mode === "AGENT"
      ? [
          { id: "modify", label: "Modify skill" },
          { id: "remove", label: "Remove skill" },
        ]
      : []),
  ];
}

export function createSkillsListOverlay(
  skills: InstalledSkillMeta[],
  maxHeight: number,
  mode: Mode = "ASK",
  density: PresentationDensity = "compact"
): SelectableListOverlay {
  return new SkillMenuOverlay({
    title: `Skills · ${skills.length} installed`,
    rows: buildSkillsMenuRows(skills, mode),
    boxSizing: "responsive",
    maxHeight,
    helpLines: ["Up/Down navigate   Enter choose action   Esc close"],
  }, density);
}

export function createSkillActionOverlay(
  skill: InstalledSkillMeta,
  maxHeight: number,
  mode: Mode = "ASK",
  density: PresentationDensity = "compact"
): SelectableListOverlay {
  return new SkillMenuOverlay({
    title: `Skill: ${skill.slug}`,
    rows: buildSkillActionRows(skill, mode),
    boxSizing: "responsive",
    maxHeight,
    helpLines: ["Up/Down navigate   Enter select   Esc back"],
  }, density);
}
