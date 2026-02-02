import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { sanitizePath } from "../util/path";

const MAX_RESULTS = 100;
const MAX_CONTENT_LENGTH = 120;

const DESCRIPTION = `Search file contents with a regex.

Required: pattern. Optional: path, include.
See docs/tools/grep.md for details.`;

const GrepSchema = z.object({
  pattern: z.string(),
  path: z.string().optional(),
  include: z.string().optional(),
});

type GrepInput = z.infer<typeof GrepSchema>;

interface Match {
  file: string;
  line: number;
  content: string;
}

function truncateContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength - 3) + "...";
}

export const grepTool: Tool<GrepInput> = Tool.define(
  "grep",
  DESCRIPTION,
  GrepSchema,
  async (input: GrepInput): Promise<ToolResult> => {
    try {
      const searchPath = sanitizePath(input.path ?? ".");

      // Build command args properly as array elements
      const cmd = [
        "rg",
        "--line-number", // Ensure line numbers in output
        "--no-heading", // One result per line (file:line:content)
        "--max-count",
        "10", // Max 10 matches per file to avoid spam
        "-m",
        String(MAX_RESULTS), // Global max results
      ];

      // Add include pattern if specified
      if (input.include) {
        cmd.push("-g", input.include);
      }

      // Add pattern and path
      cmd.push(input.pattern, searchPath);

      const result = Bun.spawnSync({
        cmd,
        env: process.env,
      });

      const stdout = (result.stdout?.toString("utf-8") ?? "") as string;
      const outputLines = stdout.split("\n").filter((line) => line.trim() !== "");

      const matches: Match[] = [];

      for (const line of outputLines) {
        // ripgrep output format: file:line:content
        const colonIndex = line.indexOf(":");
        if (colonIndex === -1) continue;

        const file = line.slice(0, colonIndex);
        const rest = line.slice(colonIndex + 1);

        const secondColonIndex = rest.indexOf(":");
        if (secondColonIndex === -1) continue;

        const lineNum = parseInt(rest.slice(0, secondColonIndex), 10);
        const content = rest.slice(secondColonIndex + 1);

        if (!isNaN(lineNum)) {
          matches.push({
            file,
            line: lineNum,
            content: truncateContent(content.trim(), MAX_CONTENT_LENGTH),
          });
        }

        // Stop early if we hit the limit
        if (matches.length >= MAX_RESULTS) break;
      }

      // Format output with truncated content
      const grepOutputLines = matches.map(
        (match) => `${match.file}:${match.line}: ${match.content}`
      );

      const totalFound = matches.length;
      const truncatedNotice =
        totalFound >= MAX_RESULTS
          ? `\n\n(Results limited to ${MAX_RESULTS}. Use ripgrep directly for full results.)`
          : "";

      return {
        success: true,
        output: grepOutputLines.join("\n") + truncatedNotice,
        metadata: {
          type: "grep",
          pattern: input.pattern,
          path: input.path,
          matchCount: totalFound,
          truncated: totalFound >= MAX_RESULTS,
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
