import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { fetchPage, snapshotWithBrowser } from "./web-utils";

const DESCRIPTION = `Read an exact HTTP(S) URL and return cleaned text.

Use web_fetch after the user provides a URL or after web_search finds a relevant result.
Falls back to bundled agent-browser when normal fetch fails.`;

const WebFetchSchema = z.object({
  url: z.string().describe("HTTP(S) URL to fetch"),
  maxChars: z.number().min(500).max(50000).optional().describe("Maximum characters to return"),
  browserFallback: z.boolean().optional().describe("Use bundled agent-browser if direct fetch fails (default true)"),
});

type WebFetchInput = z.infer<typeof WebFetchSchema>;

export const webFetchTool: Tool<WebFetchInput> = Tool.define(
  "web_fetch",
  DESCRIPTION,
  WebFetchSchema,
  async (input: WebFetchInput): Promise<ToolResult> => {
    const maxChars = input.maxChars ?? 12000;
    const browserFallback = input.browserFallback ?? true;

    try {
      const page = await fetchPage(input.url);
      const clipped = page.text.length > maxChars ? page.text.slice(0, maxChars) : page.text;
      const truncated = page.truncated || clipped.length < page.text.length;
      const header = [
        `URL: ${page.finalUrl}`,
        `Status: ${page.status}`,
        page.title ? `Title: ${page.title}` : undefined,
        page.contentType ? `Content-Type: ${page.contentType}` : undefined,
        truncated ? `Truncated: yes` : undefined,
      ].filter((line): line is string => Boolean(line));

      return {
        success: page.status >= 200 && page.status < 400,
        output: `${header.join("\n")}\n\n${clipped}`,
        metadata: {
          type: "web_fetch",
          url: input.url,
          finalUrl: page.finalUrl,
          status: page.status,
          truncated,
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

      const browser = await snapshotWithBrowser(input.url);
      if (!browser.success) {
        const directError = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          output: `Direct fetch failed: ${directError}\nBrowser fallback failed: ${browser.error ?? browser.output}`,
        };
      }

      const clipped = browser.output.length > maxChars ? browser.output.slice(0, maxChars) : browser.output;
      return {
        success: true,
        output: `URL: ${input.url}\nFetched-via: agent-browser\n${browser.output.length > maxChars ? "Truncated: yes\n" : ""}\n${clipped}`,
        metadata: {
          type: "web_fetch",
          url: input.url,
          truncated: browser.output.length > maxChars,
          fallback: true,
        },
      };
    }
  },
  { timeout: 180000 }
);
