import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { readFileSync } from "fs";
import { sanitizePath } from "../util/path";

const DESCRIPTION = `Read a file from disk with line numbers.

Required: filePath. Optional: offset, limit.
See docs/tools/file-read.md for details.`;

const ReadSchema = z.object({
  filePath: z.string(),
  offset: z.number().optional(),
  limit: z.number().optional(),
});

type ReadInput = z.infer<typeof ReadSchema>;

export const fileRead: Tool<ReadInput> = Tool.define(
  "file_read",
  DESCRIPTION,
  ReadSchema,
  async (input: ReadInput): Promise<ToolResult> => {
    try {
      let content: string;
      try {
        const safePath = sanitizePath(input.filePath);
        content = readFileSync(safePath, "utf-8");
      } catch (error) {
        return {
          success: false,
          output: error instanceof Error ? error.message : `File not found: ${input.filePath}`,
        };
      }

      const lines = content.split("\n");

      if (lines.length === 0) {
        return {
          success: true,
          output: "File exists but is empty.",
        };
      }

      const offset = input.offset ?? 0;
      const limit = input.limit ?? 2000;

      if (offset >= lines.length) {
        return {
          success: false,
          output: `Offset ${offset} is beyond file length (${lines.length} lines)`,
        };
      }

      const end = Math.min(offset + limit, lines.length);
      const selectedLines = lines.slice(offset, end);

      const outputLines = selectedLines.map((line, i) => {
        const lineNumber = offset + i + 1;
        const truncatedLine = line.length > 2000 ? line.slice(0, 2000) : line;
        return `${String(lineNumber).padStart(4, " ")}  ${truncatedLine}`;
      });

      const header = lines.length > selectedLines.length
        ? `(lines ${offset + 1}-${end} of ${lines.length})`
        : `(all ${lines.length} lines)`;

      return {
        success: true,
        output: `${header}\n${outputLines.join("\n")}`,
        metadata: {
          // Legacy fields
          totalLines: lines.length,
          returnedLines: selectedLines.length,
          offset,
          // NEW: FileReadMetadata fields
          type: "file_read",
          filePath: input.filePath,
          linesRead: selectedLines.length,
          truncated: selectedLines.length < lines.length,
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
