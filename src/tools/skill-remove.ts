import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { ask as askPermission } from "../permission";
import { SessionManager } from "../session/manager.js";
import { listInstalledSkills } from "./install-skill-source.js";
import { unregisterSkillCommand } from "../cli/slash-dispatch.js";

const DESCRIPTION = `Remove an installed skill by deleting its .agents/skills/<slug>/ directory.

Required: slug (the skill's folder name, as shown by /skills).
This operation is permanent. The skill's slash command alias (if any) is deregistered.`;

const SkillRemoveSchema = z.object({
  slug: z.string().min(1).describe("Skill slug to remove (folder name under .agents/skills/)"),
});

type SkillRemoveInput = z.infer<typeof SkillRemoveSchema>;

export const skillRemoveTool: Tool<SkillRemoveInput> = Tool.define(
  "skill_remove",
  DESCRIPTION,
  SkillRemoveSchema,
  async (input: SkillRemoveInput): Promise<ToolResult> => {
    const cwd = process.cwd();
    const skillDir = join(cwd, ".agents", "skills", input.slug);

    if (!existsSync(skillDir)) {
      return { success: false, output: `Skill '${input.slug}' is not installed.` };
    }

    await askPermission({
      sessionID: SessionManager.getCurrentSessionID() ?? "unknown",
      permission: "edit",
      patterns: [skillDir],
      message: `Remove skill: ${input.slug}`,
      metadata: { path: skillDir, slug: input.slug, reason: `Delete skill '${input.slug}'` },
    });

    // Deregister slash command alias if the skill declared one
    const skills = listInstalledSkills(cwd);
    const meta = skills.find((s) => s.slug === input.slug);
    if (meta?.command) {
      unregisterSkillCommand(meta.command);
    }

    rmSync(skillDir, { recursive: true, force: true });

    return {
      success: true,
      output: `Skill '${input.slug}' removed.`,
      metadata: { type: "skill_remove", slug: input.slug },
    };
  }
);
