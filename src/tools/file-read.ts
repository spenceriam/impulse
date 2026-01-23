import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { readFileSync } from "fs";
import { sanitizePath } from "../util/path";

const DESCRIPTION = `Reads a file from the local filesystem.

Usage:
- The filePath parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files)
- Any lines longer than 2000 characters will be truncated
- Results are returned with line numbers starting at 1

Parameters:
- filePath (required): The absolute path to the file to read
- offset (optional): The line number to start reading from (0-based)
- limit (optional): The number of lines to read (defaults to 2000)

Notes:
- You can read multiple files in parallel by making multiple tool calls
- If you read a file that exists but has empty contents, you will receive a warning
- You can read image files using this tool`;

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
