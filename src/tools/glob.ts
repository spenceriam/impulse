import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { glob as globSync } from "glob";
import { sanitizePath } from "../util/path";

const DESCRIPTION = `Fast file pattern matching tool that works with any codebase size.

Usage:
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns

Parameters:
- pattern (required): The glob pattern to match files against
- path (optional): The directory to search in (defaults to current working directory)

When to Use:
- Finding files by extension or name pattern
- Locating specific file types in a directory tree
- Quick file discovery before reading

When NOT to Use:
- Searching for content inside files (use Grep instead)
- Finding a specific known file path (use Read instead)`;

const GlobSchema = z.object({
  pattern: z.string(),
  path: z.string().optional(),
});

type GlobInput = z.infer<typeof GlobSchema>;

export const globTool: Tool<GlobInput> = Tool.define(
  "glob",
  DESCRIPTION,
  GlobSchema,
  async (input: GlobInput): Promise<ToolResult> => {
    try {
      const options = input.path ? { cwd: sanitizePath(input.path) } : {};
      const files = await globSync(input.pattern, options);

      const sortedFiles = files.sort((a, b) => {
        try {
          const mtimeA = Bun.file(a).lastModified;
          const mtimeB = Bun.file(b).lastModified;
          return mtimeB - mtimeA;
        } catch {
          return 0;
        }
      });

      return {
        success: true,
        output: sortedFiles.join("\n"),
        metadata: {
          // Legacy field
          count: sortedFiles.length,
          // NEW: GlobMetadata fields
          type: "glob",
          pattern: input.pattern,
          path: input.path,
          matchCount: sortedFiles.length,
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
