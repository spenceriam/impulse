import { type Component } from "@mariozechner/pi-tui";
import { ghost } from "../ansi-theme.js";
import { wrapGutterLines } from "../gutter.js";

/**
 * Compaction summary rendered as ghost chrome (dim+italic — the same family
 * as Worked-for and Recap lines). The full summary is preserved (newlines
 * kept: the summary is structured) and wrapped at the current terminal
 * width on every render.
 */
export class CompactedSummaryBlock implements Component {
  constructor(private readonly raw: string) {}

  invalidate(): void {}

  render(width: number): string[] {
    const lines: string[] = [];
    for (const rawLine of this.raw.split("\n")) {
      for (const wrapped of wrapGutterLines(ghost(rawLine), width)) {
        lines.push(wrapped);
      }
    }
    return lines;
  }
}
