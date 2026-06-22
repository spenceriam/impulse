import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import fs from "fs";
import path from "path";

const DESCRIPTION = `Search project files by concept using local lexical ranking.

This is a local-first semantic search foundation: it ranks files/snippets by query terms and returns verifiable file paths.`;

const SemanticSearchSchema = z.object({
  query: z.string().min(1).describe("Concept or terms to search for"),
  maxResults: z.number().int().positive().max(20).optional(),
});

type SemanticSearchInput = z.infer<typeof SemanticSearchSchema>;

const SKIP_DIRS = new Set([".git", "node_modules", "dist", ".next", "coverage"]);
const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".yml", ".yaml", ".txt", ".css",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && TEXT_EXTS.has(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_/-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function scoreFile(filePath: string, content: string, queryTerms: string[]): number {
  const haystack = `${filePath}\n${content}`.toLowerCase();
  return queryTerms.reduce((score, term) => {
    const matches = haystack.split(term).length - 1;
    return score + matches;
  }, 0);
}

function snippet(content: string, queryTerms: string): string {
  const lines = content.split(/\r?\n/);
  const lowerTerms = terms(queryTerms);
  const index = lines.findIndex((line) =>
    lowerTerms.some((term) => line.toLowerCase().includes(term))
  );
  const start = Math.max(0, index < 0 ? 0 : index - 1);
  return lines.slice(start, start + 3).join("\n").slice(0, 600);
}

export const semanticSearchTool: Tool<SemanticSearchInput> = Tool.define(
  "semantic_search",
  DESCRIPTION,
  SemanticSearchSchema,
  async (input: SemanticSearchInput): Promise<ToolResult> => {
    const cwd = process.cwd();
    const queryTerms = terms(input.query);
    const maxResults = input.maxResults ?? 8;
    const results = walk(cwd)
      .map((file) => {
        try {
          const content = fs.readFileSync(file, "utf-8");
          return {
            file: path.relative(cwd, file),
            score: scoreFile(file, content, queryTerms),
            snippet: snippet(content, input.query),
          };
        } catch {
          return null;
        }
      })
      .filter((item): item is { file: string; score: number; snippet: string } =>
        Boolean(item && item.score > 0)
      )
      .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
      .slice(0, maxResults);

    if (results.length === 0) {
      return {
        success: true,
        output: `No semantic_search results for "${input.query}".`,
        metadata: { query: input.query, results: [] },
      };
    }

    const output = results
      .map((r) => `- ${r.file} (score ${r.score})\n${r.snippet}`)
      .join("\n\n");
    return {
      success: true,
      output: `semantic_search results for "${input.query}":\n\n${output}`,
      metadata: { query: input.query, results },
    };
  }
);
