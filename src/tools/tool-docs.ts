import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const DESCRIPTION = `Read built-in tool documentation from the library.

Use list=true to list available tool docs, or name to load a specific tool doc.`;

const ToolDocsSchema = z.object({
  name: z.string().optional().describe("Tool name (e.g., file_read, bash)"),
  list: z.boolean().optional().describe("List available tool docs"),
});

type ToolDocsInput = z.infer<typeof ToolDocsSchema>;

const TOOL_DOCS_MAP: Record<string, string> = {
  bash: "bash.md",
  file_read: "file-read.md",
  file_write: "file-write.md",
  file_edit: "file-edit.md",
  glob: "glob.md",
  grep: "grep.md",
  task: "task.md",
  todo_read: "todo-read.md",
  todo_write: "todo-write.md",
  question: "question.md",
  set_header: "set-header.md",
  set_mode: "set-mode.md",
  mcp_discover: "mcp-discover.md",
  tool_docs: "tool-docs.md",
};

function getToolDocsDir(): string {
  const override = process.env["IMPULSE_TOOL_DOCS_DIR"];
  if (override && existsSync(override)) return override;

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Dev: src/tools -> ../../docs/tools
    join(here, "..", "..", "docs", "tools"),
    // Dist: dist -> docs/tools
    join(here, "docs", "tools"),
    // Fallback: src -> ../docs/tools
    join(here, "..", "docs", "tools"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0] ?? join(here, "..", "..", "docs", "tools");
}

function normalizeToolName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";

  const base = trimmed.replace(/\.md$/i, "");
  return base;
}

function listToolDocs(): string {
  const entries = Object.entries(TOOL_DOCS_MAP)
    .map(([tool, file]) => `${tool} -> ${file}`)
    .sort((a, b) => a.localeCompare(b));

  return `Tool docs available (${entries.length}):\n${entries.join("\n")}`;
}

export const toolDocsTool: Tool<ToolDocsInput> = Tool.define(
  "tool_docs",
  DESCRIPTION,
  ToolDocsSchema,
  async (input: ToolDocsInput): Promise<ToolResult> => {
    try {
      if (input.list || !input.name) {
        return {
          success: true,
          output: listToolDocs(),
        };
      }

      const normalized = normalizeToolName(input.name);
      const fileName = TOOL_DOCS_MAP[normalized];
      if (!fileName) {
        return {
          success: false,
          output: `Unknown tool: ${input.name}. Use list=true to see available docs.`,
        };
      }

      const docsDir = getToolDocsDir();
      const filePath = join(docsDir, fileName);

      if (!existsSync(filePath)) {
        return {
          success: false,
          output: `Tool docs not found for ${normalized}. Expected: ${filePath}`,
        };
      }

      const content = readFileSync(filePath, "utf-8");
      return {
        success: true,
        output: content,
        metadata: {
          tool: normalized,
          path: filePath,
        },
      };
    } catch (error) {
      return {
        success: false,
        output: error instanceof Error ? error.message : String(error),
      };
    }
  }
);
