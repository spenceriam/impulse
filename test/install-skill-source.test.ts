import { describe, expect, test } from "bun:test";
import {
  normalizeSkillSource,
  skillInstructionsPath,
} from "../src/tools/install-skill-source.js";

describe("normalizeSkillSource", () => {
  test("rejects repo-only source", () => {
    const result = normalizeSkillSource("mattpocock/skills");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("repository");
    }
  });

  test("accepts full skill path", () => {
    const result = normalizeSkillSource(
      "mattpocock/skills/skills/engineering/grill-with-docs"
    );
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.source).toBe(
        "mattpocock/skills/skills/engineering/grill-with-docs"
      );
      expect(result.skillSlug).toBe("grill-with-docs");
    }
  });

  test("normalizes GitHub tree URL", () => {
    const result = normalizeSkillSource(
      "https://github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs"
    );
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.source).toBe(
        "mattpocock/skills/skills/engineering/grill-with-docs"
      );
      expect(result.skillSlug).toBe("grill-with-docs");
    }
  });

  test("rejects too-short path", () => {
    const result = normalizeSkillSource("owner/repo");
    expect("error" in result).toBe(true);
  });
});

describe("skillInstructionsPath", () => {
  test("resolves under .agents/skills", () => {
    expect(skillInstructionsPath("/proj", "grill-with-docs")).toBe(
      "/proj/.agents/skills/grill-with-docs/SKILL.md"
    );
  });
});