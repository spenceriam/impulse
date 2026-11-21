/**
 * Extract fenced code blocks from assistant markdown for `/copy code` (#130).
 *
 * The point is paste-clean text: no fence markers, no chat gutters, no
 * markdown indentation, no soft-wrap breaks. One block per fence, in order.
 */

export interface CodeBlock {
  /** Language tag from the opening fence, lowercased; "" when unlabeled. */
  lang: string;
  /** Body lines, verbatim except for fence indentation removal. */
  lines: string[];
}

const FENCE_RE = /^(\s*)(`{3,}|~{3,})\s*([\w#+.-]*)\s*$/;

/** Parse fenced blocks. An unclosed fence runs to the end (streamed replies). */
export function extractCodeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  let current: CodeBlock | null = null;
  let fenceIndent = "";
  let fenceChar = "";

  for (const raw of markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    const match = raw.match(FENCE_RE);
    if (match) {
      const indent = match[1] ?? "";
      const marker = match[2] ?? "";
      if (!current) {
        current = { lang: (match[3] ?? "").toLowerCase(), lines: [] };
        fenceIndent = indent;
        fenceChar = marker[0] ?? "`";
        continue;
      }
      // A closing fence uses the same character and is at least as long.
      if (marker[0] === fenceChar) {
        blocks.push(current);
        current = null;
        fenceIndent = "";
        fenceChar = "";
        continue;
      }
    }
    if (current) {
      // Remove only the fence's own indentation so nested code keeps its shape.
      current.lines.push(
        fenceIndent && raw.startsWith(fenceIndent) ? raw.slice(fenceIndent.length) : raw
      );
    }
  }

  if (current) blocks.push(current);
  return blocks;
}

/** Clipboard text for `/copy code`: bodies joined, fences and tags stripped. */
export function codeBlocksToText(blocks: CodeBlock[]): string {
  return blocks
    .map((b) => b.lines.join("\n").replace(/\n+$/, ""))
    .filter((body) => body.trim().length > 0)
    .join("\n\n");
}

/** One-line confirmation, e.g. `Copied 2 code blocks (14 lines)`. */
export function describeCodeBlocks(blocks: CodeBlock[]): string {
  const usable = blocks.filter((b) => b.lines.join("").trim().length > 0);
  const lines = usable.reduce((n, b) => n + b.lines.filter((l) => l.trim()).length, 0);
  const langs = [...new Set(usable.map((b) => b.lang).filter(Boolean))];
  const what = usable.length === 1 ? "1 code block" : `${usable.length} code blocks`;
  const lineNote = lines === 1 ? "1 line" : `${lines} lines`;
  const langNote = langs.length > 0 ? ` · ${langs.join(", ")}` : "";
  return `Copied ${what} (${lineNote})${langNote}`;
}
