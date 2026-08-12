import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { stat, readdir } from "fs/promises";
import { sanitizePath } from "../util/path";
import { currentExecutionContext, executionCwd } from "../execution/context.js";
import { zFilePath } from "./schemas/branded";
import { buildLsPathNote, prependToolNote } from "./tool-notes";

const LS_MAX_ENTRIES = 500;
const LS_MAX_OUTPUT_BYTES = 64 * 1024;

const DESCRIPTION = `List directory entries (files and subdirectories).

Optional: path (defaults to current working directory), limit.
See docs/tools/ls.md for details.`;

const LsSchema = z.object({
  path: zFilePath().optional(),
  limit: z.number().int().positive().optional(),
});

type LsInput = z.infer<typeof LsSchema>;

export const lsTool: Tool<LsInput> = Tool.define(
  "ls",
  DESCRIPTION,
  LsSchema,
  async (input: LsInput): Promise<ToolResult> => {
    try {
      const displayPath = input.path ?? ".";
      const execution = currentExecutionContext();
      const safePath = execution
        ? await execution.boundary.resolvePath(displayPath, "read")
        : sanitizePath(displayPath);

      let stats;
      try {
        stats = await stat(safePath);
      } catch (error) {
        const isNotFound =
          error instanceof Error &&
          ("code" in error ? (error as NodeJS.ErrnoException).code === "ENOENT" : error.message.includes("ENOENT"));
        if (isNotFound) {
          return { success: false, output: `Directory not found: ${displayPath}` };
        }
        throw error;
      }

      if (!stats.isDirectory()) {
        return {
          success: false,
          output: `${displayPath} is a file, not a directory. Use file_read to read it.`,
        };
      }

      const entries = await readdir(safePath, { withFileTypes: true });
      const names = entries
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

      const effectiveLimit = Math.min(input.limit ?? LS_MAX_ENTRIES, LS_MAX_ENTRIES);
      const shown: string[] = [];
      let bytes = 0;
      for (const name of names) {
        if (shown.length >= effectiveLimit) break;
        bytes += name.length + 1;
        if (bytes > LS_MAX_OUTPUT_BYTES) break;
        shown.push(name);
      }
      const truncated = shown.length < names.length;

      const header = `${safePath} (${names.length} entries)`;
      const footer = truncated ? `\n(showing first ${shown.length} of ${names.length} entries)` : "";
      const body = shown.length > 0 ? `${header}\n${shown.join("\n")}${footer}` : `${header}\n(empty)`;

      const pathNote = buildLsPathNote(input, executionCwd());

      return {
        success: true,
        output: prependToolNote(body, pathNote),
        metadata: {
          type: "ls",
          path: input.path,
          entryCount: shown.length,
          totalEntries: names.length,
          truncated,
        },
      };
    } catch (error) {
      if (error instanceof Error) {
        return { success: false, output: error.message };
      }
      return { success: false, output: String(error) };
    }
  }
);
