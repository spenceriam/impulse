/**
 * Chat-experience preview (#160).
 *
 * A scripted turn replayed through the real rendering pieces: the Quiet
 * narration/settle formatters, the collapsed ToolBlock rows for Verbose, the
 * MarkdownTextBlock for assistant prose, and the same label/ghost styling the
 * chat uses. Each frame is an ordered list of chat rows, so the preview cannot
 * drift from shipped rendering the way a hardcoded ANSI mockup would.
 *
 * The script is data: PreviewFrame[] with a time offset. The overlay ticks at
 * the same cadence as the busy shimmer and plays the frame whose time has come.
 */

import { truncateToWidth, visibleWidth, type Component } from "@mariozechner/pi-tui";
import { MarkdownTextBlock } from "./markdown-text.js";
import { ToolBlock } from "./tool-block.js";
import { GUTTER } from "../gutter.js";
import { ghost } from "../ansi-theme.js";
import { formatQuietLiveStatus, formatWorkedFor } from "../quiet-status.js";
import type { ChatDensity } from "../../util/config.js";

const A = {
  reset: "\x1b[0m",
  fg: (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`,
};

export interface PreviewFrame {
  atMs: number;
  /** One chat row per element, styled by the real helpers. */
  rows: (width: number) => string[];
}

const USER = "Spencer";
const PROMPT = "Review what changed this week";
const PROSE = "Three commits landed since Friday: Quiet shipped, plus two fixes.";

function labelLine(name: string, color: 33 | 36): string {
  return `${GUTTER}${A.fg(color, name)}`;
}

function proseRows(width: number, text: string): string[] {
  const md = new MarkdownTextBlock(GUTTER);
  md.setText(text);
  return md.render(width);
}

function quietNarration(elapsedMs: number): string {
  return ghost(
    formatQuietLiveStatus({
      tools: [{ id: "1", name: "file_read", arg: "CHANGELOG.md" }],
      elapsedMs,
    })
  );
}

function quietSettle(): string {
  return ghost(`${formatWorkedFor(3000)} using 2 tools`);
}

function quietRecap(): string {
  return ghost("Recap: reviewed the week's commits; nothing broken");
}

function toolRow(name: string, arg: Record<string, unknown>, width: number): string[] {
  const block = ToolBlock.fromCompleted(
    name,
    arg,
    { success: true, output: "" },
    1200
  );
  return block.render(width);
}

function rowList(...groups: Array<string[] | string>): string[] {
  return groups.flatMap((g) => (typeof g === "string" ? [g] : g));
}

const PROMPT_ROWS = (width: number) =>
  rowList(labelLine(USER, 36), ...proseRows(width, PROMPT), "");
const PROSE_ROWS = (width: number) =>
  rowList(labelLine("impulse", 33), ...proseRows(width, PROSE));

/** One canned turn: a prompt, two tools, prose, and a Recap. */
const QUIET_SCRIPT: PreviewFrame[] = [
  { atMs: 0, rows: PROMPT_ROWS },
  { atMs: 300, rows: (w) => [...PROMPT_ROWS(w), quietNarration(1000)] },
  { atMs: 1300, rows: (w) => [...PROMPT_ROWS(w), quietNarration(2000)] },
  { atMs: 2500, rows: (w) => [...PROMPT_ROWS(w), quietSettle()] },
  {
    atMs: 2800,
    rows: (w) => [...PROMPT_ROWS(w), quietSettle(), "", ...PROSE_ROWS(w)],
  },
  {
    atMs: 4500,
    rows: (w) => [
      ...PROMPT_ROWS(w),
      quietSettle(),
      "",
      ...PROSE_ROWS(w),
      quietRecap(),
    ],
  },
];

/** The same turn through the Verbose path: every tool call visible. */
const VERBOSE_SCRIPT: PreviewFrame[] = [
  { atMs: 0, rows: PROMPT_ROWS },
  {
    atMs: 300,
    rows: (w) => [...PROMPT_ROWS(w), ...toolRow("bash", { command: "git log --oneline -20" }, w)],
  },
  {
    atMs: 1300,
    rows: (w) => [
      ...PROMPT_ROWS(w),
      ...toolRow("bash", { command: "git log --oneline -20" }, w),
      ...toolRow("file_read", { filePath: "CHANGELOG.md" }, w),
    ],
  },
  {
    atMs: 2800,
    rows: (w) => [
      ...PROMPT_ROWS(w),
      ...toolRow("bash", { command: "git log --oneline -20" }, w),
      ...toolRow("file_read", { filePath: "CHANGELOG.md" }, w),
      "",
      ...PROSE_ROWS(w),
    ],
  },
];

/** One full loop of the script, then restart. */
export const PREVIEW_LOOP_MS = 6000;

export function previewScript(density: ChatDensity): PreviewFrame[] {
  return density === "verbose" ? VERBOSE_SCRIPT : QUIET_SCRIPT;
}

/** The frame in effect at `elapsedMs` (looped). Pure, so it is testable. */
export function frameAt(script: PreviewFrame[], elapsedMs: number): PreviewFrame {
  const looped = elapsedMs % PREVIEW_LOOP_MS;
  let current = script[0]!;
  for (const frame of script) {
    if (frame.atMs <= looped) current = frame;
    else break;
  }
  return current;
}

export class ChatPreviewOverlay implements Component {
  private density: ChatDensity;
  private readonly height: number;
  private readonly startAtMs: number;
  private startedAt: number;

  constructor(opts: { density: ChatDensity; height?: number; startAtMs?: number }) {
    this.density = opts.density;
    this.height = opts.height ?? 12;
    // Open on the settled frame so the whole turn is visible immediately;
    // the 6s loop then plays from the top.
    this.startAtMs = opts.startAtMs ?? 4500;
    this.startedAt = Date.now() - this.startAtMs;
  }

  setDensity(density: ChatDensity): void {
    if (density === this.density) return;
    this.density = density;
    this.startedAt = Date.now() - this.startAtMs;
  }

  /** Frame for the current time. Called on every render tick. */
  frame(now = Date.now()): PreviewFrame {
    return frameAt(previewScript(this.density), now - this.startedAt);
  }

  tick(_now?: number): void {
    // No mutable state: each render derives its frame from the clock.
  }

  invalidate(): void {}

  render(width: number): string[] {
    const frame = this.frame();
    const lines = frame.rows(width);
    // Fixed height so the overlay never jumps as frames change.
    const padded = lines.slice(0, this.height);
    while (padded.length < this.height) padded.push("");
    return padded;
  }
}

/**
 * First-run picker (#160): choose Quiet or Verbose with the same live preview.
 * Enter confirms, Esc keeps Quiet. Rendered as a standalone overlay.
 */
export class ChatExperiencePicker implements Component {
  private selected: 0 | 1;
  private readonly preview: ChatPreviewOverlay;
  private readonly width: number;

  onConfirm?: (density: ChatDensity) => void;

  constructor(opts: { density?: ChatDensity; width?: number } = {}) {
    const density = opts.density ?? "quiet";
    this.selected = density === "verbose" ? 1 : 0;
    this.preview = new ChatPreviewOverlay({ density, height: 11, startAtMs: 4500 });
    this.width = opts.width ?? 76;
  }

  invalidate(): void {
    this.preview.invalidate();
  }

  private density(): ChatDensity {
    return this.selected === 1 ? "verbose" : "quiet";
  }

  handleInput(data: string): void {
    if (data === "\x1b[A" || data === "\x1b[D" || data === "k") {
      this.selected = 0;
    } else if (data === "\x1b[B" || data === "\x1b[C" || data === "j" || data === "\t") {
      this.selected = 1;
    } else if (data === " ") {
      this.selected = this.selected === 0 ? 1 : 0;
    } else if (data === "\r" || data === "\n") {
      this.onConfirm?.(this.density());
      return;
    } else if (data === "\x1b") {
      this.onConfirm?.("quiet"); // skip keeps the default
      return;
    }
    this.preview.setDensity(this.density());
  }

  render(_width: number): string[] {
    const w = this.width;
    // ANSI-aware: styled rows (ghost italic, tool icons) must not be sliced
    // by raw string length or the right border lands inside the text.
    const line = (inner: string) => {
      const clipped = truncateToWidth(inner, w - 2, "");
      // visibleWidth (not string length) so ANSI escapes do not eat the padding.
      const pad = Math.max(0, w - 2 - visibleWidth(clipped));
      return `│${clipped}${" ".repeat(pad)}│`;
    };
    const out: string[] = [];
    out.push(`┌─ How should impulse chat? ${"─".repeat(Math.max(0, w - 29))}┐`);
    out.push(line(""));
    const opt = (idx: 0 | 1, label: string, note: string) =>
      line((`  ${idx === this.selected ? "●" : "○"} ${label}  ${note}`).slice(0, w - 3));
    out.push(opt(0, "Quiet", "narration line, Worked for, Recap"));
    out.push(opt(1, "Verbose", "full tool stream"));
    out.push(line(""));
    const density = this.density();
    const previewLines = this.preview.render(w - 6);
    out.push(line(`  Preview: ${density === "quiet" ? "Quiet" : "Verbose"}`));
    for (const l of previewLines) out.push(line(`  ${l}`));
    out.push(line(""));
    out.push(line("  ↑↓ choose   Enter confirm   Esc skip (keeps Quiet)"));
    out.push(`└${"─".repeat(w - 2)}┘`);
    return out;
  }
}
