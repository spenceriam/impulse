import { type Component } from "@mariozechner/pi-tui";
import { wrapTextWithAnsi } from "@mariozechner/pi-tui";

/**
 * CTRL+T transcript: the entire chat — user prompts, AI streams, tool
 * calls and results, thinking — in chronological order with hh:mm:ss
 * timestamps. Esc returns to the normal screen.
 */

export interface TranscriptEntry {
  at: string;
  kind: "user" | "assistant" | "tool" | "thinking" | "system";
  text: string;
}

const RESET = "\x1b[0m";
const DIM = (s: string) => `\x1b[2m${s}${RESET}`;
const CYAN = (s: string) => `\x1b[36m${s}${RESET}`;
const GREEN = (s: string) => `\x1b[32m${s}${RESET}`;
const YELLOW = (s: string) => `\x1b[33m${s}${RESET}`;
const MAGENTA = (s: string) => `\x1b[35m${s}${RESET}`;

const KIND_LABEL: Record<TranscriptEntry["kind"], string> = {
  user: "you",
  assistant: "impulse",
  tool: "tool",
  thinking: "thinking",
  system: "system",
};

const CHROME_TOP = 2;
const CHROME_BOTTOM = 2;

export class TranscriptOverlay implements Component {
  private scrollTop = 0;
  private lastInnerWidth = 80;
  onCancel?: () => void;

  constructor(
    private readonly entries: TranscriptEntry[],
    private readonly maxHeight: number
  ) {}

  invalidate(): void {}

  private viewportBodyLines(): number {
    return Math.max(1, this.maxHeight - CHROME_TOP - CHROME_BOTTOM);
  }

  handleInput(data: string): void {
    if (data === "\x1b") {
      this.onCancel?.();
      return;
    }
    const body = this.bodyLines(this.lastInnerWidth);
    const maxTop = Math.max(0, body.length - this.viewportBodyLines());
    let next = this.scrollTop;
    if (data === "\x1b[A" || data === "k") next = Math.max(0, this.scrollTop - 1);
    else if (data === "\x1b[B" || data === "j") next = Math.min(maxTop, this.scrollTop + 1);
    else if (data === "\x1b[5~") next = Math.max(0, this.scrollTop - this.viewportBodyLines());
    else if (data === "\x1b[6~") next = Math.min(maxTop, this.scrollTop + this.viewportBodyLines());
    else if (data === "\x1b[H" || data === "g") next = 0;
    else if (data === "\x1b[F" || data === "G") next = maxTop;
    else return;
    this.scrollTop = next;
  }

  render(width: number): string[] {
    const innerWidth = Math.max(30, width - 4);
    this.lastInnerWidth = innerWidth;

    const header = `${DIM("┌")} ${CYAN("TRANSCRIPT")} ${DIM("─".repeat(Math.max(0, innerWidth - 14)))} ${DIM("Esc back ┐")}`;
    const body = this.bodyLines(innerWidth);
    const viewport = this.viewportBodyLines();
    const maxTop = Math.max(0, body.length - viewport);
    this.scrollTop = Math.min(this.scrollTop, maxTop);
    const window = body.slice(
      this.scrollTop === maxTop ? body.length - viewport : this.scrollTop,
      (this.scrollTop === maxTop ? body.length - viewport : this.scrollTop) + viewport
    );
    const scrollHint = body.length > viewport ? DIM(` ↑↓/PgUp/PgDn · ${body.length} rows`) : "";
    const footer = `${DIM("└")}${DIM("─".repeat(Math.max(0, innerWidth - 2)))}${scrollHint}${DIM("┘")}`;

    return [header, ...window, footer];
  }

  private bodyLines(innerWidth: number): string[] {
    const lines: string[] = [];
    for (const entry of this.entries) {
      const label = KIND_LABEL[entry.kind];
      const color =
        entry.kind === "user" ? CYAN :
        entry.kind === "assistant" ? GREEN :
        entry.kind === "tool" ? YELLOW :
        entry.kind === "thinking" ? MAGENTA : DIM;
      const stamp = DIM(entry.at);
      const wrapped = wrapTextWithAnsi(entry.text, Math.max(10, innerWidth - 18));
      wrapped.forEach((line, index) => {
        const prefix = index === 0 ? `${stamp} ${color(label.padEnd(9))}` : " ".repeat(9 + 9);
        lines.push(`${prefix} ${DIM("│")} ${line}`);
      });
      lines.push("");
    }
    return lines;
  }
}

/** Build transcript entries from persisted session messages. */
export function transcriptEntriesFromMessages(
  messages: Array<Record<string, unknown>>,
  userName: string
): TranscriptEntry[] {
  KIND_LABEL.user = userName;
  const entries: TranscriptEntry[] = [];
  for (const message of messages) {
    const role = message["role"];
    const at = formatStamp(typeof message["timestamp"] === "string" ? message["timestamp"] : "");
    if (role === "user") {
      entries.push({ at, kind: "user", text: textOf(message["content"]) || textOf(message["apiContent"]) || "(empty)" });
    } else if (role === "assistant") {
      const reasoning = typeof message["reasoning_content"] === "string" ? message["reasoning_content"] : "";
      if (reasoning.trim()) {
        entries.push({ at, kind: "thinking", text: reasoning.trim() });
      }
      const text = textOf(message["content"]);
      if (text.trim()) {
        entries.push({ at, kind: "assistant", text: text.trim() });
      }
      const calls = message["tool_calls"];
      if (Array.isArray(calls)) {
        for (const call of calls) {
          const fn = (call as { function?: { name?: string; arguments?: string } }).function;
          if (!fn?.name) continue;
          entries.push({ at, kind: "tool", text: `${fn.name} ${truncate(fn.arguments ?? "", 120)}` });
        }
      }
    } else if (role === "tool") {
      entries.push({ at, kind: "tool", text: `→ ${truncate(textOf(message["content"]), 200)}` });
    } else if (role === "system") {
      const text = textOf(message["content"]);
      if (text.trim()) entries.push({ at, kind: "system", text: text.trim() });
    }
  }
  return entries;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : ""
      )
      .join("");
  }
  return "";
}

function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function formatStamp(iso: string): string {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return "  --:--:--";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}
