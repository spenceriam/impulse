import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { mkdirSync, statSync, writeFileSync, existsSync } from "fs";
import { resolve, relative, isAbsolute } from "path";
import { sanitizePath } from "../util/path";
import { ask as askPermission } from "../permission";

const DESCRIPTION = `Writes a file to the local filesystem.

Usage:
- This tool will overwrite an existing file if there is one at the provided path
- If this is an existing file, you MUST use the Read tool first to read the file's contents
- ALWAYS prefer editing existing files in the codebase over creating new ones
- NEVER proactively create documentation files (*.md) or README files unless explicitly requested
- Only use emojis if the user explicitly requests it

Parameters:
- filePath (required): The absolute path to the file to write (must be absolute, not relative)
- content (required): The content to write to the file

Notes:
- Creates parent directories if they don't exist
- Preserves file permissions when overwriting`;

const WriteSchema = z.object({
  filePath: z.string(),
  content: z.string(),
});

type WriteInput = z.infer<typeof WriteSchema>;

/**
 * Check if a path is within the current working directory
 */
function isWithinCwd(targetPath: string): boolean {
  const cwd = process.cwd();
  const absoluteTarget = isAbsolute(targetPath) 
    ? targetPath 
    : resolve(cwd, targetPath);
  const relativePath = relative(cwd, absoluteTarget);
  
  // If relative path starts with "..", it's outside cwd
  return !relativePath.startsWith("..");
}

export const fileWrite: Tool<WriteInput> = Tool.define(
  "file_write",
  DESCRIPTION,
  WriteSchema,
  async (input: WriteInput): Promise<ToolResult> => {
    try {
      const safePath = sanitizePath(input.filePath);
      const dir = safePath.substring(0, safePath.lastIndexOf("/"));
      
      // Determine if this is a new file or overwrite
      const isNewFile = !existsSync(safePath);
      const permissionType = isNewFile ? "write" : "edit";
      
      // Only ask permission for files outside the working directory
      if (!isWithinCwd(safePath)) {
        await askPermission({
          sessionID: "current",
          permission: permissionType,
          patterns: [safePath],
          message: isNewFile ? `Create file outside cwd: ${safePath}` : `Overwrite file outside cwd: ${safePath}`,
          metadata: {
            contentLength: input.content.length,
            isNewFile,
            reason: "Path outside working directory",
          },
        });
      }

      if (dir && dir.length > 0) {
        mkdirSync(dir, { recursive: true });
      }

      let existingPermissions: number | undefined;
      try {
        const stats = statSync(safePath);
        existingPermissions = stats.mode;
      } catch {
      }

      writeFileSync(safePath, input.content, "utf-8");

      if (existingPermissions !== undefined) {
        const stats = statSync(safePath);
        stats.mode = existingPermissions;
      }

      // Count lines written
      const linesWritten = input.content.split("\n").length;

      return {
        success: true,
        output: `File written successfully: ${input.filePath}`,
        metadata: {
          type: "file_write",
          filePath: input.filePath,
          linesWritten,
          created: isNewFile,
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
