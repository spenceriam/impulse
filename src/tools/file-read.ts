import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { createReadStream } from "fs";
import { readFile, stat } from "fs/promises";
import readline from "readline";
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

const STREAM_READ_THRESHOLD = 2_000_000; // 2MB
const MAX_LINE_LENGTH = 2000;

async function readLinesStream(
  filePath: string,
  offset: number,
  limit: number
): Promise<{ lines: string[]; totalLines?: number; truncated: boolean }> {
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const lines: string[] = [];
  let lineIndex = 0;
  let truncated = false;

  try {
    for await (const line of rl) {
      if (lineIndex >= offset && lines.length < limit) {
        lines.push(line);
      }
      lineIndex++;
      if (lines.length >= limit) {
        truncated = true;
        break;
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  const result: { lines: string[]; totalLines?: number; truncated: boolean } = {
    lines,
    truncated,
  };
  if (!truncated) {
    result.totalLines = lineIndex;
  }
  return result;
}

export const fileRead: Tool<ReadInput> = Tool.define(
  "file_read",
  DESCRIPTION,
  ReadSchema,
  async (input: ReadInput): Promise<ToolResult> => {
    try {
      const safePath = sanitizePath(input.filePath);
      const offset = input.offset ?? 0;
      const limit = input.limit ?? 2000;

      let lines: string[] = [];
      let totalLines: number | undefined;
      let truncated = false;

      try {
        const stats = await stat(safePath);
        if (stats.size > STREAM_READ_THRESHOLD) {
          const result = await readLinesStream(safePath, offset, limit);
          lines = result.lines;
          totalLines = result.totalLines;
          truncated = result.truncated;
        } else {
          const content = await readFile(safePath, "utf-8");
          const allLines = content.split("\n");
          totalLines = allLines.length;
          if (totalLines === 0) {
            return {
              success: true,
              output: "File exists but is empty.",
            };
          }

          if (offset >= totalLines) {
            return {
              success: false,
              output: `Offset ${offset} is beyond file length (${totalLines} lines)`,
            };
          }

          const end = Math.min(offset + limit, totalLines);
          lines = allLines.slice(offset, end);
          truncated = end < totalLines;
        }
      } catch (error) {
        return {
          success: false,
          output: error instanceof Error ? error.message : `File not found: ${input.filePath}`,
        };
      }

      if (totalLines !== undefined && offset >= totalLines) {
        return {
          success: false,
          output: `Offset ${offset} is beyond file length (${totalLines} lines)`,
        };
      }

      if (lines.length === 0) {
        return {
          success: true,
          output: "File exists but is empty.",
        };
      }

      const end = offset + lines.length;

      const outputLines = lines.map((line, i) => {
        const lineNumber = offset + i + 1;
        const truncatedLine = line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) : line;
        return `${String(lineNumber).padStart(4, " ")}  ${truncatedLine}`;
      });

      const header = totalLines !== undefined
        ? (truncated
          ? `(lines ${offset + 1}-${end} of ${totalLines})`
          : `(all ${totalLines} lines)`)
        : `(lines ${offset + 1}-${end} of unknown; large file)`;

      return {
        success: true,
        output: `${header}\n${outputLines.join("\n")}`,
        metadata: {
          // Legacy fields
          totalLines: totalLines ?? lines.length,
          returnedLines: lines.length,
          offset,
          // NEW: FileReadMetadata fields
          type: "file_read",
          filePath: input.filePath,
          linesRead: lines.length,
          truncated: totalLines !== undefined ? truncated : true,
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
