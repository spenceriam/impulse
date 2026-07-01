import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { ask as askPermission } from "../permission";
import { SessionManager } from "../session/manager.js";
import { registerSkillCommand } from "../cli/slash-dispatch.js";
import {
  formatSkillReadyMessage,
  isSkillInstalled,
  listInstalledSkills,
  normalizeSkillSource,
  skillInstructionsPath,
} from "./install-skill-source.js";

/** Register the skill's `command:` frontmatter alias, if any, so it's usable this session. */
function registerCommandsForSkill(cwd: string, skillSlug: string): void {
  const meta = listInstalledSkills(cwd).find((s) => s.slug === skillSlug);
  if (meta?.command) {
    registerSkillCommand(meta.command, skillSlug);
  }
}

const DESCRIPTION = `Install a single agent skill via \`npx skills@latest add\` (non-interactive).

Use in PLAN when a referenced skill is missing. Always pass the **full skill path**, not the repo root:
- Good: mattpocock/skills/skills/engineering/grill-with-docs
- Bad: mattpocock/skills (installs all skills in the repo)

GitHub tree URLs to a skill folder are accepted. After install, read \`.agents/skills/<name>/SKILL.md\`.
Interview/grill skills require the question tool (one topic per call), not markdown questions in chat.`;

const InstallSkillSchema = z.object({
  source: z
    .string()
    .min(1)
    .describe(
      "Full skill path (owner/repo/.../skill-name) or GitHub tree URL — not repo root only"
    ),
  global: z
    .boolean()
    .optional()
    .describe("Install globally when supported (default: project-local)"),
});

type InstallSkillInput = z.infer<typeof InstallSkillSchema>;

export const installSkillTool: Tool<InstallSkillInput> = Tool.define(
  "install_skill",
  DESCRIPTION,
  InstallSkillSchema,
  async (input: InstallSkillInput): Promise<ToolResult> => {
    const normalized = normalizeSkillSource(input.source);
    if ("error" in normalized) {
      return { success: false, output: normalized.error };
    }

    const { source, skillSlug } = normalized;
    const cwd = process.cwd();
    const instructionsPath = skillInstructionsPath(cwd, skillSlug);

    if (isSkillInstalled(cwd, skillSlug)) {
      registerCommandsForSkill(cwd, skillSlug);
      // If the skill was edited by the user, do not overwrite it
      const existing = listInstalledSkills(cwd).find((s) => s.slug === skillSlug);
      if (existing?.edited) {
        return {
          success: true,
          output: `${formatSkillReadyMessage(skillSlug, instructionsPath)}\nNote: skill has local edits — not overwritten.`,
        };
      }
      return {
        success: true,
        output: formatSkillReadyMessage(skillSlug, instructionsPath),
      };
    }

    const sessionId = SessionManager.getCurrentSessionID() ?? "unknown";
    const args = ["skills@latest", "add", source, "-y"];
    if (input.global) {
      args.push("-g");
    }
    const command = `npx ${args.join(" ")}`;

    await askPermission({
      sessionID: sessionId,
      permission: "bash",
      patterns: [command],
      message: `Install skill: ${skillSlug}`,
      metadata: {
        command,
        tool: "install_skill",
        skillSlug,
        reason: `Install the "${skillSlug}" skill from the skills registry`,
      },
    });

    const proc = Bun.spawn(["npx", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: { ...process.env, CI: "1" },
    });

    const timeoutMs = 120_000;
    const timedOut = await Promise.race([
      proc.exited.then(() => false),
      Bun.sleep(timeoutMs).then(() => true),
    ]);

    if (timedOut) {
      proc.kill();
      return {
        success: false,
        output: [
          `Skill install timed out after ${timeoutMs / 1000}s.`,
          "The skills CLI may be waiting for interactive input — use a full skill path, not the repo root.",
        ].join("\n"),
      };
    }

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = proc.exitCode ?? 1;

    if (exitCode !== 0) {
      return {
        success: false,
        output: [`Skill install failed (exit ${exitCode})`, stderr || stdout].filter(Boolean).join("\n"),
      };
    }

    if (!isSkillInstalled(cwd, skillSlug)) {
      const cliOutput = [stdout, stderr].filter((s) => s.trim()).join("\n");
      return {
        success: false,
        output: [
          `Install finished but ${instructionsPath} was not found.`,
          "Check the skill path — the last segment must match the installed folder name.",
          cliOutput,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }

    registerCommandsForSkill(cwd, skillSlug);
    const cliOutput = [stdout, stderr].filter((s) => s.trim()).join("\n");
    const ready = formatSkillReadyMessage(skillSlug, instructionsPath);
    return {
      success: true,
      output: cliOutput ? `${cliOutput}\n\n${ready}` : ready,
    };
  },
  { timeout: 130_000 }
);