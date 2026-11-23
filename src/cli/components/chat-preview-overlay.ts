/**
 * Chat-experience preview (#160).
 *
 * A scripted turn replayed through the real rendering pieces (MarkdownTextBlock,
 * the Quiet narration/settle formatters, tool rows), so the preview cannot drift
 * from shipped rendering the way a hardcoded ANSI mockup would.
 *
 * The script is data: `PreviewFrame[]` with a time offset. The overlay ticks at
 * the same cadence as the busy shimmer and plays the frames whose time has come.
 */

import type { Component } from "@mariozechner/pi-tui";
import { MarkdownTextBlock } from "./markdown-text.js";
import { GUTTER } from "../gutter.js";
import type { ChatDensity } from "../../util/config.js";

export interface PreviewFrame {
  atMs: number;
  /** Markdown rows to show from this frame on (replaces the previous body). */
  body: string;
}

/** One canned turn: a prompt, two tools, prose, and a Recap. */
const QUIET_SCRIPT: PreviewFrame[] = [
  { atMs: 0, body: "**Spencer**\nReview what changed this week" },
  {
    atMs: 300,
    body: "**Spencer**\nReview what changed this week\n\n_Reading CHANGELOG.md… (1s)_",
  },
  {
    atMs: 1300,
    body: "**Spencer**\nReview what changed this week\n\n_Reading CHANGELOG.md… (2s)_",
  },
  {
    atMs: 2500,
    body:
      "**Spencer**\nReview what changed this week\n\nWorked for 3s using 2 tools",
  },
  {
    atMs: 2800,
    body:
      "**Spencer**\nReview what changed this week\n\nWorked for 3s using 2 tools\n\n**impulse**\nThree commits landed since Friday: Quiet shipped, plus two fixes.",
  },
  {
    atMs: 4500,
    body:
      "**Spencer**\nReview what changed this week\n\nWorked for 3s using 2 tools\n\n**impulse**\nThree commits landed since Friday: Quiet shipped, plus two fixes.\n\n_Recap: reviewed the week's commits; nothing broken_",
  },
];

/** The same turn through the Verbose path: every tool call visible. */
const VERBOSE_SCRIPT: PreviewFrame[] = [
  { atMs: 0, body: "**Spencer**\nReview what changed this week" },
  {
    atMs: 300,
    body:
      "**Spencer**\nReview what changed this week\n\n`▶ bash git log --oneline -20`  OK",
  },
  {
    atMs: 1300,
    body:
      "**Spencer**\nReview what changed this week\n\n`▶ bash git log --oneline -20`  OK\n`▶ file_read CHANGELOG.md`  OK",
  },
  {
    atMs: 2800,
    body:
      "**Spencer**\nReview what changed this week\n\n`▶ bash git log --oneline -20`  OK\n`▶ file_read CHANGELOG.md`  OK\n\n**impulse**\nThree commits landed since Friday: Quiet shipped, plus two fixes.",
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
  private startedAt = Date.now();
  private readonly text: MarkdownTextBlock;
  private readonly height: number;

  constructor(opts: { density: ChatDensity; height?: number }) {
    this.density = opts.density;
    this.height = opts.height ?? 12;
    this.text = new MarkdownTextBlock("  ");
    this.text.setText(frameAt(previewScript(this.density), 0).body);
  }

  setDensity(density: ChatDensity): void {
    if (density === this.density) return;
    this.density = density;
    this.startedAt = Date.now();
    this.tick();
  }

  /** Advance to the frame for the current time. Call from the render timer. */
  tick(now = Date.now()): void {
    this.text.setText(frameAt(previewScript(this.density), now - this.startedAt).body);
  }

  invalidate(): void {
    this.text.invalidate();
  }

  render(width: number): string[] {
    this.tick();
    const lines = this.text.render(width);
    // Fixed height so the overlay never jumps as frames change.
    const padded = lines.slice(0, this.height);
    while (padded.length < this.height) padded.push("");
    return padded.map((l) => `${GUTTER}${l}`);
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
    this.preview = new ChatPreviewOverlay({ density, height: 10 });
    this.width = opts.width ?? 76;
  }

  invalidate(): void {
    this.preview.invalidate();
  }

  private density(): ChatDensity {
    return this.selected === 1 ? "verbose" : "quiet";
  }

  handleInput(data: string): void {
    // up/down (and j/k) move between the two options
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
    const line = (inner: string) =>
      `│${inner.padEnd(w - 2).slice(0, w - 2)}│`;
    const out: string[] = [];
    out.push(`┌─ How should impulse chat? ${"─".repeat(Math.max(0, w - 29))}┐`);
    out.push(line(""));
    const opt = (idx: 0 | 1, label: string, note: string) =>
      line(
        (`  ${idx === this.selected ? "●" : "○"} ${label}  ${note}`).slice(0, w - 3)
      );
    out.push(opt(0, "Quiet", "narration line, Worked for, Recap"));
    out.push(opt(1, "Verbose", "full tool stream"));
    out.push(line(""));
    const previewLines = this.preview.render(w - 6);
    out.push(line(`  Preview: ${this.density() === "quiet" ? "Quiet" : "Verbose"}`));
    for (const l of previewLines) out.push(line(`  ${l}`));
    out.push(line(""));
    out.push(line("  ↑↓ choose   Enter confirm   Esc skip (keeps Quiet)"));
    out.push(`└${"─".repeat(w - 2)}┘`);
    return out;
  }
}
