import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { glob as globSync } from "glob";
import { sanitizePath } from "../util/path";
import { currentExecutionContext, executionCwd } from "../execution/context.js";
import { zFilePath, zGlobPattern } from "./schemas/branded";
import { buildGlobPathNote, prependToolNote } from "./tool-notes";

const MAX_RESULTS = 1000;

const DESCRIPTION = `Find files by glob pattern.

Required: pattern. Optional: path.
See docs/tools/glob.md for usage notes.`;

const GlobSchema = z.object({
  pattern: zGlobPattern(),
  path: zFilePath().optional(),
});

type GlobInput = z.infer<typeof GlobSchema>;

export const globTool: Tool<GlobInput> = Tool.define(
  "glob",
  DESCRIPTION,
  GlobSchema,
  async (input: GlobInput): Promise<ToolResult> => {
    try {
      const execution = currentExecutionContext();
      const basePath = execution
        ? await execution.boundary.resolvePath(input.path ?? ".", "read")
        : sanitizePath(input.path ?? ".");
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

      const pathNote = buildGlobPathNote(input, executionCwd());
      const body = limitedFiles.join("\n") + truncatedNotice;

      return {
        success: true,
        output: prependToolNote(body, pathNote),
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
