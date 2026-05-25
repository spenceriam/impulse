import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { decodeHtmlEntities, fetchPage, snapshotWithBrowser } from "./web-utils";
import {
  buildWebSearchDefaultsNote,
  prependToolNote,
  WEB_SEARCH_DEFAULT_MAX_RESULTS,
} from "./tool-notes";

const DESCRIPTION = `Search the web for current external information.

Use web_search to discover sources, then use web_fetch on exact result URLs.
Direct search is attempted first; bundled agent-browser is used as fallback.`;

const WebSearchSchema = z.object({
  query: z.string().min(1).describe("Search query"),
  maxResults: z.number().min(1).max(10).optional().describe("Maximum results to return"),
  site: z.string().optional().describe("Optional site/domain filter, e.g. github.com"),
  browserFallback: z.boolean().optional().describe("Use bundled agent-browser if direct search fails (default true)"),
});

type WebSearchInput = z.infer<typeof WebSearchSchema>;

interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

function stripTags(input: string): string {
  return decodeHtmlEntities(input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function normalizeDuckDuckGoUrl(raw: string): string {
  const decoded = decodeHtmlEntities(raw);
  try {
    const url = new URL(decoded, "https://duckduckgo.com");
    const uddg = url.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : url.toString();
  } catch {
    return decoded;
  }
}

function parseDuckDuckGoResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];
  const regex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>)?/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) && results.length < maxResults) {
    const href = match[1];
    const titleHtml = match[2];
    const snippetHtml = match[3] ?? match[4];
    if (!href || !titleHtml) continue;

    const url = normalizeDuckDuckGoUrl(href);
    if (!/^https?:\/\//i.test(url)) continue;

    const result: SearchResult = {
      title: stripTags(titleHtml),
      url,
    };
    const snippet = snippetHtml ? stripTags(snippetHtml) : undefined;
    if (snippet) result.snippet = snippet;
    results.push(result);
  }

  return results;
}

function formatResults(results: SearchResult[]): string {
  return results.map((result, index) => {
    const lines = [
      `${index + 1}. ${result.title}`,
      `   ${result.url}`,
    ];
    if (result.snippet) lines.push(`   ${result.snippet}`);
    return lines.join("\n");
  }).join("\n\n");
}

async function directSearch(input: WebSearchInput): Promise<SearchResult[]> {
  const maxResults = input.maxResults ?? 5;
  const query = input.site ? `site:${input.site} ${input.query}` : input.query;
  const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const page = await fetchPage(searchUrl);
  if (page.status < 200 || page.status >= 400) {
    throw new Error(`Search request failed with HTTP ${page.status}`);
  }

  const results = parseDuckDuckGoResults(page.raw, maxResults);
  if (results.length === 0) {
    throw new Error("Direct search returned no parseable results");
  }

  return results;
}

export const webSearchTool: Tool<WebSearchInput> = Tool.define(
  "web_search",
  DESCRIPTION,
  WebSearchSchema,
  async (input: WebSearchInput): Promise<ToolResult> => {
    const maxResults = input.maxResults ?? WEB_SEARCH_DEFAULT_MAX_RESULTS;
    const browserFallback = input.browserFallback ?? true;
    const defaultsNote = buildWebSearchDefaultsNote(input);

    try {
      const results = await directSearch(input);
      return {
        success: true,
        output: prependToolNote(formatResults(results), defaultsNote),
        metadata: {
          type: "web_search",
          query: input.query,
          resultCount: results.length,
          fallback: false,
        },
      };
    } catch (error) {
      if (!browserFallback) {
        return {
          success: false,
          output: error instanceof Error ? error.message : String(error),
        };
      }

      const query = input.site ? `site:${input.site} ${input.query}` : input.query;
      const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
      const browser = await snapshotWithBrowser(searchUrl);
      if (!browser.success) {
        const directError = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          output: `Direct search failed: ${directError}\nBrowser fallback failed: ${browser.error ?? browser.output}`,
        };
      }

      const clipped = browser.output.length > 12000 ? browser.output.slice(0, 12000) : browser.output;
      const body = `Search: ${query}\nFetched-via: agent-browser\nMax-results-requested: ${maxResults}\n${browser.output.length > 12000 ? "Truncated: yes\n" : ""}\n${clipped}`;
      return {
        success: true,
        output: prependToolNote(body, defaultsNote),
        metadata: {
          type: "web_search",
          query: input.query,
          resultCount: 0,
          fallback: true,
        },
      };
    }
  },
  { timeout: 180000 }
);
