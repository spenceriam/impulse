import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { readFileSync } from "fs";
import { sanitizePath } from "../util/path";
import { ask as askPermission } from "../permission";

const DESCRIPTION = readFileSync(
  new URL("./bash.txt", import.meta.url),
  "utf-8"
) as string;

const BashSchema = z.object({
  command: z.string(),
  description: z.string(),
  workdir: z.string().optional(),
  timeout: z.number(),
});

type BashInput = z.infer<typeof BashSchema>;

interface SpawnOptions {
  cmd: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export const bashTool: Tool<BashInput> = Tool.define(
  "bash",
  DESCRIPTION,
  BashSchema,
  async (input: BashInput): Promise<ToolResult> => {
    try {
      // Request permission before executing command
      await askPermission({
        sessionID: "current",
        permission: "bash",
        patterns: [input.command],
        message: input.description || `Execute: ${input.command.slice(0, 50)}...`,
        metadata: {
          command: input.command,
          workdir: input.workdir,
        },
      });
      
      const startTime = Date.now();
      const maxLines = 2000;

      const spawnOptions: SpawnOptions = {
        cmd: ["bash", "-c", input.command],
        env: process.env,
      };

      if (input.workdir) {
        spawnOptions.cwd = sanitizePath(input.workdir);
      }

      const result = Bun.spawnSync(spawnOptions);

      const stdout = (result.stdout?.toString("utf-8") ?? "") as string;
      const stderr = (result.stderr?.toString("utf-8") ?? "") as string;

      const outputLines = stdout.split("\n");
      let output = "";

      if (outputLines.length >= maxLines) {
        output = outputLines.slice(0, maxLines).join("\n");
        output += `\n[Output truncated to ${maxLines} lines]`;
      } else {
        output = stdout;
      }

      if (stderr) {
        output += `\n${stderr}`;
      }

      const elapsed = Date.now() - startTime;
      const exitCode = result.exitCode ?? 0;

      return {
        success: true,
        output: output || "Command completed successfully.",
        metadata: {
          duration: elapsed,
          truncated: outputLines.length >= maxLines,
          exitCode,
        },
      };
    } catch (error) {
      if (error instanceof Error) {
        let output = error.message;

        const stdoutMatch = error.message.match(/\[stdout] (.*)/);
        if (stdoutMatch) {
          output = stdoutMatch[1] ?? "";
        }

        if (error.message.includes("Command timed out")) {
          output += `\n[Timeout after ${input.timeout}ms]`;
        }

        return {
          success: false,
          output,
        };
      }

      return {
        success: false,
        output: String(error),
      };
    }
  }
);
