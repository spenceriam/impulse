import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { detectValidationCommands } from "../util/project-validation.js";

const DESCRIPTION = `Detect project validation commands.

Lists likely typecheck/test/build/lint commands for the current project.`;

const ProjectValidateSchema = z.object({
  cwd: z.string().optional().describe("Directory to inspect; defaults to current working directory"),
});

type ProjectValidateInput = z.infer<typeof ProjectValidateSchema>;

export const projectValidateTool: Tool<ProjectValidateInput> = Tool.define(
  "project_validate",
  DESCRIPTION,
  ProjectValidateSchema,
  async (input: ProjectValidateInput): Promise<ToolResult> => {
    const cwd = input.cwd?.trim() || process.cwd();
    const commands = detectValidationCommands(cwd);
    if (commands.length === 0) {
      return {
        success: true,
        output: `No standard validation commands detected in ${cwd}.`,
        metadata: { cwd, commands: [] },
      };
    }

    return {
      success: true,
      output: [
        `Validation commands for ${cwd}:`,
        ...commands.map((cmd) => `- ${cmd.name}: ${cmd.command} (${cmd.source})`),
      ].join("\n"),
      metadata: { cwd, commands },
    };
  }
);
