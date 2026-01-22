import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { readFileSync } from "fs";
import { sanitizePath } from "../util/path";

const DESCRIPTION = readFileSync(
  new URL("./grep.txt", import.meta.url),
  "utf-8"
) as string;

const GrepSchema = z.object({
  pattern: z.string(),
  path: z.string(),
  include: z.string(),
});

type GrepInput = z.infer<typeof GrepSchema>;

interface Match {
  file: string;
  line: number;
  content: string;
}

export const grepTool: Tool<GrepInput> = Tool.define(
  "grep",
  DESCRIPTION,
  GrepSchema,
  async (input: GrepInput): Promise<ToolResult> => {
    try {
      const matches: Match[] = [];
      const searchPath = sanitizePath(input.path ?? ".");
      const includeArgs = input.include ? `-g "${input.include}"` : "";

      const spawnOptions = {
        cmd: ["rg", input.pattern, searchPath, includeArgs],
        env: process.env,
      };

      const result = Bun.spawnSync(spawnOptions);

      const stdout = (result.stdout?.toString("utf-8") ?? "") as string;
      const outputLines = stdout.split("\n");
      const fileLines = outputLines.filter((line) => line.trim() !== "");

      for (const line of fileLines) {
        if (input.include && !line.endsWith(input.include)) {
          continue;
      // @ts-ignore
      // @ts-ignore
        }

        const match = line.match(/^(.*?)(\d+):(.*)$/);
        if (match && match[1] && match[2] && match[3]) {
          const file = match[1];
          const lineNum = match[2];
          const content = match[3];
          matches.push({ file, line: parseInt(lineNum, 10), content });
        }
      }

      const sortedMatches = matches.sort((a, b) => {
        try {
          const mtimeA = Bun.file(a.file).lastModified;
          const mtimeB = Bun.file(b.file).lastModified;
          return mtimeB - mtimeA;
        } catch {
          return 0;
        }
      });

      const grepOutputLines = sortedMatches.map(
        (match) => `${match.file}:${match.line}: ${match.content}`
      );

      return {
        success: true,
        output: grepOutputLines.join("\n"),
        metadata: {
          // Legacy field
          count: sortedMatches.length,
          // NEW: GrepMetadata fields
          type: "grep",
          pattern: input.pattern,
          path: input.path,
          matchCount: sortedMatches.length,
        },
      };
    } catch (error) {
      if (error instanceof Error) {
        return {
          success: false,
          output: error.message,
        };
      }

      return {
        success: false,
        output: String(error),
      };
    }
  }
);
