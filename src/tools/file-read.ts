import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { createReadStream, openSync, readSync, closeSync } from "fs";
import { readFile, stat, readdir } from "fs/promises";
import readline from "readline";
import { sanitizePath } from "../util/path";
import { zFilePath } from "./schemas/branded";
import {
  buildFileReadRangeNote,
  FILE_READ_DEFAULT_LIMIT,
  prependToolNote,
} from "./tool-notes";
import path from "path";

const DESCRIPTION = `Read a file from disk with line numbers.

Required: filePath. Optional: offset, limit.
filePath must be a FILE, not a directory. Use ls to list directories.
See docs/tools/file-read.md for details.`;

const ReadSchema = z.object({
  filePath: zFilePath(),
  offset: z.number().optional(),
  limit: z.number().optional(),
});

type ReadInput = z.infer<typeof ReadSchema>;

const STREAM_READ_THRESHOLD = 2_000_000; // 2MB
const MAX_LINE_LENGTH = 2000;
const BINARY_SNIFF_BYTES = 512;

// Magic-byte signatures [label, magic-bytes (with -1 meaning "any byte")]
const BINARY_SIGNATURES: Array<[string, number[]]> = [
  ["PNG image",    [0x89, 0x50, 0x4e, 0x47]],
  ["JPEG image",   [0xff, 0xd8, 0xff]],
  ["GIF image",    [0x47, 0x49, 0x46]],
  ["PDF",          [0x25, 0x50, 0x44, 0x46]],
  ["ZIP archive",  [0x50, 0x4b, 0x03, 0x04]],
  ["ELF binary",   [0x7f, 0x45, 0x4c, 0x46]],
  ["PE binary",    [0x4d, 0x5a]],
];

function detectBinaryOrEncoding(filePath: string): { isBinary: true; label: string } | { isBinary: false; hasBOM: boolean; bomNote?: string } | null {
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(BINARY_SNIFF_BYTES);
    const bytesRead = readSync(fd, buf, 0, BINARY_SNIFF_BYTES, 0);
    if (bytesRead === 0) return null;
    const header = buf.subarray(0, bytesRead);

    // UTF-16 LE BOM (FF FE)
    if (bytesRead >= 2 && header[0] === 0xff && header[1] === 0xfe) {
      return { isBinary: false, hasBOM: true, bomNote: "UTF-16 LE (BOM detected)" };
    }
    // UTF-16 BE BOM (FE FF)
    if (bytesRead >= 2 && header[0] === 0xfe && header[1] === 0xff) {
      return { isBinary: false, hasBOM: true, bomNote: "UTF-16 BE (BOM detected)" };
    }
    // UTF-8 BOM (EF BB BF)
    if (bytesRead >= 3 && header[0] === 0xef && header[1] === 0xbb && header[2] === 0xbf) {
      return { isBinary: false, hasBOM: true, bomNote: "UTF-8 BOM stripped" };
    }

    // Known binary magic bytes
    for (const [label, magic] of BINARY_SIGNATURES) {
      if (bytesRead >= magic.length && magic.every((b, i) => b === -1 || header[i] === b)) {
        return { isBinary: true, label };
      }
    }

    // Heuristic: >30% NUL bytes → binary
    let nulCount = 0;
    for (let i = 0; i < bytesRead; i++) {
      if (header[i] === 0) nulCount++;
    }
    if (nulCount / bytesRead > 0.3) {
      return { isBinary: true, label: "binary file" };
    }

    return { isBinary: false, hasBOM: false };
  } finally {
    closeSync(fd);
  }
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j - 1]!, dp[j]!);
      prev = temp;
    }
  }
  return dp[n]!;
}

const NOT_FOUND_LISTING_MAX_ENTRIES = 15;
const NOT_FOUND_LISTING_MAX_CHARS = 300;

type DirEntry = { name: string; isDirectory: () => boolean };

/** Compact "Directory <dir> (N entries): a/, b/, c" listing line from already-fetched entries. */
function formatDirListingLine(dir: string, entries: DirEntry[]): string | null {
  const displayNames = [...entries]
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));

  if (displayNames.length === 0) return null;

  const shown = displayNames.slice(0, NOT_FOUND_LISTING_MAX_ENTRIES);
  const more = displayNames.length > shown.length ? ` (+${displayNames.length - shown.length} more)` : "";
  let listing = `Directory ${dir}${path.sep} (${displayNames.length} entries): ${shown.join(", ")}${more}`;
  if (listing.length > NOT_FOUND_LISTING_MAX_CHARS) {
    listing = `${listing.slice(0, NOT_FOUND_LISTING_MAX_CHARS - 1)}…`;
  }
  return listing;
}

/** Compact directory listing line for a directory path, fetching entries itself. */
async function buildDirListingLine(dir: string): Promise<string | null> {
  let entries: DirEntry[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  return formatDirListingLine(dir, entries);
}

/** Error output for a file_read call that targeted a directory instead of a file. */
async function buildDirectoryError(displayPath: string, safePath: string): Promise<ToolResult> {
  const listing = await buildDirListingLine(safePath);
  const base = `Cannot read ${displayPath}: this is a directory, not a file. Use ls to list it, glob to find files under it, or grep to search inside it.`;
  return { success: false, output: listing ? `${base}\n${listing}` : base };
}

/**
 * On ENOENT, build a "Did you mean" fuzzy suggestion plus a compact listing
 * of the parent directory, reusing a single readdir() call for both.
 */
async function buildNotFoundHint(filePath: string): Promise<string | null> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  let entries: DirEntry[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  const parts: string[] = [];

  // Hyphen/underscore swap OR Levenshtein ≤ 2
  const swapped = base.replace(/[-_]/g, (c) => (c === "-" ? "_" : "-"));
  const candidates = entries
    .map((e) => e.name)
    .filter((name) => {
      if (name === base) return false;
      if (name === swapped) return true;
      return levenshtein(base.toLowerCase(), name.toLowerCase()) <= 2;
    });
  if (candidates.length > 0) {
    parts.push(`Did you mean: ${candidates.slice(0, 3).join(", ")}?`);
  }

  const listing = formatDirListingLine(dir, entries);
  if (listing) parts.push(listing);

  return parts.length > 0 ? parts.join("\n") : null;
}

export { buildFileReadRangeNote } from "./tool-notes";

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
      const limit = input.limit ?? FILE_READ_DEFAULT_LIMIT;
      const rangeNote = buildFileReadRangeNote(input);

      let lines: string[] = [];
      let totalLines: number | undefined;
      let truncated = false;

      try {
        const stats = await stat(safePath);

        if (stats.isDirectory()) {
          return buildDirectoryError(input.filePath, safePath);
        }

        // Sniff for binary/BOM before attempting UTF-8 read
        const encoding = detectBinaryOrEncoding(safePath);
        if (encoding?.isBinary) {
          return {
            success: false,
            output: `Cannot read binary file: ${input.filePath} (detected: ${encoding.label}). Use bash tool to inspect or process binary files.`,
          };
        }
        if (encoding && !encoding.isBinary && encoding.hasBOM && encoding.bomNote !== "UTF-8 BOM stripped") {
          return {
            success: false,
            output: `Cannot read file: ${input.filePath} (${encoding.bomNote}). Use bash tool with appropriate encoding conversion.`,
          };
        }

        if (stats.size > STREAM_READ_THRESHOLD) {
          const result = await readLinesStream(safePath, offset, limit);
          lines = result.lines;
          totalLines = result.totalLines;
          truncated = result.truncated;
        } else {
          // Strip UTF-8 BOM if present before splitting
          let rawContent = await readFile(safePath, "utf-8");
          if (rawContent.charCodeAt(0) === 0xfeff) rawContent = rawContent.slice(1);
          const allLines = rawContent.split("\n");
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
        const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
        const isNotFound = code === "ENOENT" || (error instanceof Error && error.message.includes("ENOENT"));
        if (isNotFound) {
          const hint = await buildNotFoundHint(safePath);
          const base = `File not found: ${input.filePath}`;
          return {
            success: false,
            output: hint ? `${base}\n${hint}` : base,
          };
        }
        const isDirectory = code === "EISDIR" || (error instanceof Error && error.message.includes("EISDIR"));
        if (isDirectory) {
          return buildDirectoryError(input.filePath, safePath);
        }
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

      const body = `${header}\n${outputLines.join("\n")}`;
      const output = prependToolNote(body, rangeNote);

      return {
        success: true,
        output,
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
