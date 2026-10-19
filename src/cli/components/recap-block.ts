import { type Component } from "@mariozechner/pi-tui";
import { ghost } from "../ansi-theme.js";
import { wrapGutterLines } from "../gutter.js";

/**
 * Width-aware Recap block (#175). The ghost Recap used to be wrapped once at
 * emission width and frozen as static Text rows — widening the terminal (e.g.
 * closing a split pane) left it stuck at the old narrow width. This component
 * stores the raw one-line recap and re-wraps at the CURRENT width on every
 * render, exactly like MarkdownTextBlock does for prose.
 */
export class QuietRecapBlock implements Component {
  constructor(private readonly rawLine: string) {}

  invalidate(): void {}

  render(width: number): string[] {
    // Collapse hard newlines from model-authored recaps — one flowing
    // paragraph, no stranded fragments (same rule as wrapQuietRecapLines).
    const flat = this.rawLine.replace(/\s*\n\s*/g, " ");
    return wrapGutterLines(ghost(flat), width);
  }
}
