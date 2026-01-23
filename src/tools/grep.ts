import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { sanitizePath } from "../util/path";

const DESCRIPTION = `Fast content search tool that works with any codebase size.

Usage:
- Searches file contents using regular expressions
- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Filter files by pattern with the include parameter
- Returns file paths and line numbers with matches, sorted by modification time

Parameters:
- pattern (required): The regex pattern to search for in file contents
- path (optional): The directory to search in (defaults to current working directory)
- include (optional): File pattern to include (e.g., "*.js", "*.{ts,tsx}")

When to Use:
- Finding files containing specific patterns
- Locating function definitions or usages
- Searching for error messages or log statements

Notes:
- Use Bash with rg (ripgrep) directly if you need to count matches within files`;

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
