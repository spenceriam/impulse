import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { glob as globSync } from "glob";
import { sanitizePath } from "../util/path";

const MAX_RESULTS = 1000;

const DESCRIPTION = `Find files by glob pattern.

Required: pattern. Optional: path.
See docs/tools/glob.md for usage notes.`;

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
      const basePath = sanitizePath(input.path ?? ".");
      const options = {
        cwd: basePath,
        nodir: true, // Only return files, not directories
      };

      const files = await globSync(input.pattern, options);

      // Limit results for efficiency (no expensive mtime sorting)
      const limitedFiles = files.slice(0, MAX_RESULTS);
      const wasTruncated = files.length > MAX_RESULTS;

      const truncatedNotice = wasTruncated
        ? `\n\n(Results limited to ${MAX_RESULTS} files. Total matches: ${files.length})`
        : "";

      return {
        success: true,
        output: limitedFiles.join("\n") + truncatedNotice,
        metadata: {
          type: "glob",
          pattern: input.pattern,
          path: input.path,
          matchCount: limitedFiles.length,
          totalMatches: files.length,
          truncated: wasTruncated,
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
