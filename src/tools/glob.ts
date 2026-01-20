import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { readFileSync } from "fs";
import { glob as globSync } from "glob";
import { sanitizePath } from "../util/path";

const DESCRIPTION = readFileSync(
  new URL("./glob.txt", import.meta.url),
  "utf-8"
);

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
          count: sortedFiles.length,
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
