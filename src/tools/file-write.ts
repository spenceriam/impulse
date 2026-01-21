import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { readFileSync, mkdirSync, statSync, writeFileSync, existsSync } from "fs";
import { sanitizePath } from "../util/path";
import { ask as askPermission } from "../permission";

const DESCRIPTION = readFileSync(
  new URL("./file-write.txt", import.meta.url),
  "utf-8"
);

const WriteSchema = z.object({
  filePath: z.string(),
  content: z.string(),
});

type WriteInput = z.infer<typeof WriteSchema>;

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
      
      // Request permission before writing
      await askPermission({
        sessionID: "current",
        permission: permissionType,
        patterns: [safePath],
        message: isNewFile ? `Create file: ${safePath}` : `Overwrite file: ${safePath}`,
        metadata: {
          contentLength: input.content.length,
          isNewFile,
        },
      });

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

      return {
        success: true,
        output: `File written successfully: ${input.filePath}`,
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
