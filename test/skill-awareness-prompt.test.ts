import { afterEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { generateSystemPrompt, invalidatePromptCache } from "../src/agent/prompts.js";
import { createDefaultConfig } from "../src/util/config.js";

const roots: string[] = [];

afterEach(() => {
  invalidatePromptCache();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("installed skill awareness", () => {
  test.each(["ASK", "AGENT"] as const)(
    "%s proactively matches relevant skills and reads instructions on demand",
    async (mode) => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-skill-prompt-"));
      roots.push(cwd);
      const skillDir = path.join(cwd, ".agents", "skills", "tdd");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        "---\nname: tdd\ndescription: Build test-first\ncommand: tdd\n---\n\nInstructions.\n"
      );

      invalidatePromptCache();
      const prompt = await generateSystemPrompt(mode, cwd, createDefaultConfig(), {
        sessionId: `skill-${mode}`,
      });

      expect(prompt).toContain("Compare each user request to the installed skill names and descriptions");
      expect(prompt).toContain("read its SKILL.md completely before acting");
      expect(prompt).toContain("Do not wait for the user to name a skill");
      expect(prompt).not.toContain("(/tdd)");
      if (mode === "ASK") {
        expect(prompt).toContain("read-only guidance");
        expect(prompt).toContain("execution handoff");
      }
    }
  );
});
