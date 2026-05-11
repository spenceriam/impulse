import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const MAX_FETCH_BYTES = 1_500_000;
const DEFAULT_TIMEOUT_MS = 20_000;

export interface FetchPageResult {
  finalUrl: string;
  status: number;
  contentType: string;
  title?: string;
  raw: string;
  text: string;
  truncated: boolean;
}

export interface BrowserResult {
  success: boolean;
  output: string;
  error?: string;
}

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, num: string) => String.fromCodePoint(parseInt(num, 10)));
}

export function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = match?.[1]?.replace(/\s+/g, " ").trim();
  return title ? decodeHtmlEntities(title) : undefined;
}

export function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|p|div|section|article|header|footer|li|tr|h[1-6])\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  if (a === undefined || b === undefined) return false;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

export function parsePublicHttpUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.startsWith("127.") ||
    isPrivateIpv4(hostname)
  ) {
    throw new Error(`Refusing to fetch local or private network URL: ${rawUrl}`);
  }

  return parsed;
}

async function readResponseText(response: Response): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) {
    return { text: await response.text(), truncated: false };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;

    const remaining = MAX_FETCH_BYTES - total;
    if (remaining <= 0) {
      truncated = true;
      break;
    }

    if (value.byteLength > remaining) {
      chunks.push(value.slice(0, remaining));
      total += remaining;
      truncated = true;
      break;
    }

    chunks.push(value);
    total += value.byteLength;
  }

  if (truncated) {
    await reader.cancel();
  }
  reader.releaseLock();
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(concatChunks(chunks, total)), truncated };
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export async function fetchPage(rawUrl: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<FetchPageResult> {
  const url = parsePublicHttpUrl(rawUrl);
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "accept": "text/html, text/plain, application/xhtml+xml, application/json;q=0.8, */*;q=0.1",
      "user-agent": "IMPULSE/1.0 (+https://github.com/spenceriam/impulse)",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (
    contentType &&
    !/text\/|application\/(json|xml|xhtml\+xml|rss\+xml|atom\+xml)/i.test(contentType)
  ) {
    throw new Error(`Unsupported content type: ${contentType}`);
  }

  const { text: body, truncated } = await readResponseText(response);
  const isHtml = /html/i.test(contentType) || /<html[\s>]/i.test(body);
  const text = isHtml ? htmlToText(body) : body.trim();

  const result: FetchPageResult = {
    finalUrl: response.url || url.toString(),
    status: response.status,
    contentType,
    raw: body,
    text,
    truncated,
  };
  const title = isHtml ? extractTitle(body) : undefined;
  if (title) result.title = title;
  return result;
}

function candidateAgentBrowserBins(): string[] {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const candidates = [
    join(process.cwd(), "node_modules", ".bin", `agent-browser${suffix}`),
  ];

  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    candidates.push(join(dir, "node_modules", ".bin", `agent-browser${suffix}`));
    candidates.push(join(dir, "..", "node_modules", ".bin", `agent-browser${suffix}`));
    dir = dirname(dir);
  }

  candidates.push(`agent-browser${suffix}`);
  return Array.from(new Set(candidates));
}

function resolveAgentBrowserCommand(): string {
  for (const candidate of candidateAgentBrowserBins()) {
    if (candidate.startsWith("agent-browser") || existsSync(candidate)) {
      return candidate;
    }
  }
  return process.platform === "win32" ? "agent-browser.cmd" : "agent-browser";
}

export async function runAgentBrowser(args: string[], timeoutMs = 30_000): Promise<BrowserResult> {
  const command = resolveAgentBrowserCommand();
  const proc = Bun.spawn({
    cmd: [command, ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  const stdoutPromise = proc.stdout ? new Response(proc.stdout).text() : Promise.resolve("");
  const stderrPromise = proc.stderr ? new Response(proc.stderr).text() : Promise.resolve("");
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<number>((resolve) => {
    timeoutId = setTimeout(() => {
      proc.kill();
      resolve(-1);
    }, timeoutMs);
  });

  const exitCode = await Promise.race([proc.exited, timeout]);
  if (timeoutId) clearTimeout(timeoutId);
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

  if (exitCode === 0) {
    return { success: true, output: stdout.trim() };
  }

  return {
    success: false,
    output: stdout.trim(),
    error: (stderr || stdout || `agent-browser exited with code ${exitCode}`).trim(),
  };
}

export async function snapshotWithBrowser(rawUrl: string, timeoutMs = 45_000): Promise<BrowserResult> {
  const url = parsePublicHttpUrl(rawUrl).toString();
  const open = await runAgentBrowser(["open", url], timeoutMs);
  if (!open.success) {
    const install = await runAgentBrowser(["install"], 120_000);
    if (!install.success) {
      return {
        success: false,
        output: open.output,
        error: `agent-browser open failed: ${open.error ?? open.output}\nagent-browser install failed: ${install.error ?? install.output}`,
      };
    }

    const retry = await runAgentBrowser(["open", url], timeoutMs);
    if (!retry.success) return retry;
  }

  return runAgentBrowser(["snapshot", "-i"], timeoutMs);
}
