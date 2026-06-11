/** Max chars persisted on any single tool result message (API + session history). */
export const MAX_TOOL_RESULT_CHARS = 150_000;

/** Max bytes returned from bash stdout/stderr after line caps. */
export const MAX_BASH_OUTPUT_BYTES = 200_000;

/** Per-line cap for bash output (mirrors file_read). */
export const MAX_BASH_LINE_CHARS = 2000;

/** Max chars for a single tool message kept in compaction tail / prompts. */
export const MAX_COMPACT_TOOL_MESSAGE_CHARS = 2000;

export function capToolResultContent(content: string, maxChars = MAX_TOOL_RESULT_CHARS): string {
  if (content.length <= maxChars) return content;
  const omitted = content.length - maxChars;
  return `${content.slice(0, maxChars)}\n[output truncated: ${omitted} chars omitted]`;
}

export function capBashOutputLines(
  raw: string,
  maxLines: number,
  maxLineChars = MAX_BASH_LINE_CHARS,
  maxBytes = MAX_BASH_OUTPUT_BYTES
): { output: string; truncated: boolean } {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rawLines = normalized.length > 0 ? normalized.split("\n") : [];
  const cappedLines: string[] = [];
  let totalBytes = 0;
  let truncated = false;

  for (let i = 0; i < rawLines.length && cappedLines.length < maxLines; i++) {
    let line = rawLines[i]!;
    if (line.length > maxLineChars) {
      line = `${line.slice(0, maxLineChars)}…`;
      truncated = true;
    }
    const lineBytes = Buffer.byteLength(line, "utf8") + (cappedLines.length > 0 ? 1 : 0);
    if (totalBytes + lineBytes > maxBytes) {
      truncated = true;
      break;
    }
    cappedLines.push(line);
    totalBytes += lineBytes;
  }

  if (rawLines.length > maxLines) truncated = true;

  let output = cappedLines.join("\n");
  if (truncated) {
    const parts: string[] = [];
    if (rawLines.length > maxLines) {
      parts.push(`line limit ${maxLines}`);
    }
    if (totalBytes >= maxBytes) {
      parts.push(`byte limit ${maxBytes}`);
    }
    const reason = parts.length > 0 ? parts.join(", ") : "size limit";
    output += `\n[Output truncated: ${reason}]`;
  }

  return { output, truncated };
}

export function stubOversizedMessageContent(
  content: string,
  maxChars: number
): string {
  if (content.length <= maxChars) return content;
  return `[truncated ${content.length} chars]\n${content.slice(0, maxChars)}`;
}
