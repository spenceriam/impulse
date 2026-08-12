import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  buildSkillActionRows,
  buildSkillRows,
  buildSkillsMenuRows,
} from "../src/cli/skills-presentation.js";
import { SelectableListOverlay } from "../src/cli/components/selectable-list-overlay.js";
import { removeSkill } from "../src/tools/skill-remove.js";
import type { InstalledSkillMeta } from "../src/tools/install-skill-source.js";

describe("buildSkillRows", () => {
  test("maps slug and description into row fields without top-level command chrome", () => {
    const skills: InstalledSkillMeta[] = [
      { slug: "grill-with-docs", name: "Grill", description: "Interview-style doc grilling", command: "grill", path: "/x/SKILL.md" },
      { slug: "no-frills", name: "Plain", path: "/y/SKILL.md" },
    ];
    const rows = buildSkillRows(skills);

    expect(rows[0]).toEqual({
      id: "grill-with-docs",
      label: "grill-with-docs",
      secondary: "Interview-style doc grilling",
    });
    expect(rows[1]).toEqual({ id: "no-frills", label: "no-frills" });
    expect(rows[1]?.metaRight).toBeUndefined();
    expect(rows[1]?.secondary).toBeUndefined();
  });

  test("shows progressive use/inspect actions and gates management by authority", () => {
    const skill: InstalledSkillMeta = {
      slug: "grill-with-docs",
      name: "Grill",
      description: "Interview-style doc grilling",
      command: "grill",
      path: "/x/SKILL.md",
    };

    expect(buildSkillActionRows(skill, "ASK").map((row) => row.label)).toEqual([
      "Use skill",
      "Inspect instructions",
    ]);
    expect(buildSkillActionRows(skill, "AGENT").map((row) => row.label)).toEqual([
      "Use skill",
      "Inspect instructions",
      "Modify skill",
      "Remove skill",
    ]);
  });

  test("offers install only in AGENT and has a truthful ASK empty state", () => {
    expect(buildSkillsMenuRows([], "ASK")).toEqual([
      {
        id: "skills:empty",
        label: "No skills installed",
        secondary: "ASK can inspect skills; switch to AGENT to install one",
      },
    ]);
    expect(buildSkillsMenuRows([], "AGENT").map((row) => row.label)).toEqual([
      "No skills installed",
      "Install skill…",
    ]);
  });

  test("returns an empty array for no skills", () => {
    expect(buildSkillRows([])).toEqual([]);
  });
});

describe("skill remove confirm overlay defaults to Cancel", () => {
  test("pressing Enter with no navigation selects Cancel (first row)", () => {
    const selections: string[] = [];
    const overlay = new SelectableListOverlay({
      title: "Remove skill: test",
      rows: [
        { id: "cancel", label: "Cancel" },
        { id: "remove", label: "Remove" },
      ],
      boxSizing: "content",
      maxHeight: 10,
    });
    overlay.onSelect = (id) => selections.push(id);

    overlay.handleInput("\r");

    expect(selections).toEqual(["cancel"]);
  });

  test("navigating down then Enter selects Remove", () => {
    const selections: string[] = [];
    const overlay = new SelectableListOverlay({
      title: "Remove skill: test",
      rows: [
        { id: "cancel", label: "Cancel" },
        { id: "remove", label: "Remove" },
      ],
      boxSizing: "content",
      maxHeight: 10,
    });
    overlay.onSelect = (id) => selections.push(id);

    overlay.handleInput("\x1b[B"); // down
    overlay.handleInput("\r");

    expect(selections).toEqual(["remove"]);
  });
});

describe("removeSkill", () => {
  let tmp: string;
  const slug = "remove-me-test";

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-remove-skill-"));
    const skillDir = path.join(tmp, ".agents", "skills", slug);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${slug}\ndescription: test\ncommand: removemetest\n---\n\nBody.\n`
    );
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("deletes the skill directory", () => {
    const result = removeSkill(tmp, slug);

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(tmp, ".agents", "skills", slug))).toBe(false);
  });

  test("reports failure for a skill that isn't installed", () => {
    const result = removeSkill(tmp, "does-not-exist");
    expect(result.success).toBe(false);
    expect(result.message).toContain("not installed");
  });
});
