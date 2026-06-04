import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { ask as askPermission } from "../permission";
import { SessionManager } from "../session/manager.js";

const DESCRIPTION = `Install an agent skill package (e.g. from the skills registry).

Runs \`npx skills@latest add <source>\` in the project. Use in PLAN mode when planning needs a referenced skill.
Does not grant general shell access.`;

const InstallSkillSchema = z.object({
  source: z
    .string()
    .min(1)
    .describe("Skill source, e.g. mattpocock/skills or a package path from the skills CLI"),
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
    const sessionId = SessionManager.getCurrentSessionID() ?? "unknown";
    const args = ["skills@latest", "add", input.source];
    if (input.global) {
      args.push("--global");
    }
    const command = `npx ${args.join(" ")}`;

    await askPermission({
      sessionID: sessionId,
      permission: "bash",
      patterns: [command],
      message: `Install skill: ${input.source}`,
      metadata: { command, tool: "install_skill" },
    });

    const proc = Bun.spawn(["npx", ...args], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
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
        output: `Skill install timed out after ${timeoutMs / 1000}s`,
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

    return {
      success: true,
      output: [stdout, stderr].filter((s) => s.trim()).join("\n") || `Installed skill: ${input.source}`,
    };
  },
  { timeout: 130_000 }
);