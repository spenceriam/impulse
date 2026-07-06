import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { ask as askPermission } from "../permission";
import { SessionManager } from "../session/manager.js";
import { registerSkillCommand, unregisterSkillCommand } from "../cli/slash-dispatch.js";
import { listInstalledSkills } from "./install-skill-source.js";

const DESCRIPTION = `Create or update a skill SKILL.md file at .agents/skills/<slug>/SKILL.md.

Required: slug (kebab-case name), content (full SKILL.md text).
Optional: command (slash command alias without leading /).

The skill becomes available immediately. If a 'command' field is present in the
frontmatter of the content, that slash command will be registered for this session.
Always include YAML frontmatter at the top:

---
name: My Skill
description: One-line purpose
command: myslash  # optional slash command alias
---

Keep SKILL.md short — one purpose, one question topic at a time for interview flows.`;

const SkillWriteSchema = z.object({
  slug: z.string().regex(/^[\w-]+$/, "slug must be alphanumeric/hyphens only").describe("Short kebab-case identifier for the skill"),
  content: z.string().min(1).describe("Full SKILL.md content (include YAML frontmatter)"),
});

type SkillWriteInput = z.infer<typeof SkillWriteSchema>;

export const skillWriteTool: Tool<SkillWriteInput> = Tool.define(
  "skill_write",
  DESCRIPTION,
  SkillWriteSchema,
  async (input: SkillWriteInput): Promise<ToolResult> => {
    const cwd = process.cwd();
    const skillDir = join(cwd, ".agents", "skills", input.slug);
    const skillPath = join(skillDir, "SKILL.md");

    await askPermission({
      sessionID: SessionManager.getCurrentSessionID() ?? "unknown",
      permission: "write",
      patterns: [skillPath],
      message: `Create/update skill: ${input.slug}`,
      metadata: { path: skillPath, slug: input.slug, reason: `Write skill file for '${input.slug}'` },
    });

    const existing = listInstalledSkills(cwd).find((s) => s.slug === input.slug);
    if (existing?.command) {
      unregisterSkillCommand(existing.command);
    }

    mkdirSync(skillDir, { recursive: true });
    writeFileSync(skillPath, input.content, { encoding: "utf-8", mode: 0o644 });

    // Register slash command if frontmatter declares one
    const fm = input.content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
    const rawCmd = fm?.match(/^command:\s*(.*)$/m)?.[1]?.trim();
    const command = rawCmd?.replace(/^["']|["']$/g, "");
    if (command) {
      registerSkillCommand(command, input.slug);
    }

    return {
      success: true,
      output: `Skill '${input.slug}' written to ${skillPath}`,
      metadata: { type: "skill_write", slug: input.slug, path: skillPath },
    };
  }
);
