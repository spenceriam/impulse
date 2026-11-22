import { describe, expect, test } from "bun:test";
import {
  availableEntries,
  BASIC_SKILLS,
  buildSkillCatalog,
  installedEntries,
  isBasicSkill,
  parseSkillArg,
} from "../src/skills/skill-catalog.js";

const bundled = [
  { slug: "implement", description: "do the work" },
  { slug: "tdd", description: "test first" },
  { slug: "code-map", description: "map the code" },
  { slug: "triage", description: "sort issues" },
];

describe("buildSkillCatalog (#138)", () => {
  test("installed skills are marked and merged with bundled metadata", () => {
    const catalog = buildSkillCatalog(
      [{ slug: "tdd", command: "tdd" }, { slug: "my-own", description: "mine" }],
      bundled
    );
    const tdd = catalog.find((e) => e.slug === "tdd")!;
    expect(tdd.installed).toBe(true);
    expect(tdd.command).toBe("tdd");
    expect(tdd.description).toBe("test first"); // bundled description kept
    expect(catalog.find((e) => e.slug === "my-own")!.installed).toBe(true);
  });

  test("bundled-but-not-installed skills are available, not installed", () => {
    const catalog = buildSkillCatalog([], bundled);
    expect(installedEntries(catalog)).toHaveLength(0);
    expect(availableEntries(catalog).map((e) => e.slug).sort()).toEqual(["code-map", "triage"]);
  });

  test("basic skills are never listed as available", () => {
    const catalog = buildSkillCatalog([], bundled);
    const available = availableEntries(catalog).map((e) => e.slug);
    for (const basic of BASIC_SKILLS) expect(available).not.toContain(basic);
  });

  test("installed entries sort before available ones", () => {
    const catalog = buildSkillCatalog([{ slug: "zzz-installed" }], bundled);
    const firstAvailable = catalog.findIndex((e) => !e.installed);
    const lastInstalled = catalog.map((e) => e.installed).lastIndexOf(true);
    expect(lastInstalled).toBeLessThan(firstAvailable);
  });

  test("isBasicSkill only knows the basic set", () => {
    expect(isBasicSkill("tdd")).toBe(true);
    expect(isBasicSkill("triage")).toBe(false);
  });
});

describe("parseSkillArg (#138)", () => {
  test("management subcommands", () => {
    expect(parseSkillArg("new")).toEqual({ action: "new", slug: "" });
    expect(parseSkillArg("remove my-skill")).toEqual({ action: "remove", slug: "my-skill" });
    expect(parseSkillArg("modify my-skill")).toEqual({ action: "modify", slug: "my-skill" });
    expect(parseSkillArg("install https://x/y/SKILL.md")).toEqual({
      action: "install",
      slug: "https://x/y/SKILL.md",
    });
  });

  test("a bare slug runs that skill, multi-word included", () => {
    expect(parseSkillArg("tdd")).toEqual({ action: "run", slug: "tdd" });
    expect(parseSkillArg("code review")).toEqual({ action: "run", slug: "code review" });
  });

  test("empty lists", () => {
    expect(parseSkillArg("  ")).toEqual({ action: "list", slug: "" });
  });
});
