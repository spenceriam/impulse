import { visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { clr } from "./ansi-theme.js";
import { GUTTER, innerWidth, truncateGutterLine } from "./gutter.js";
import type { PromptSubmitPayload } from "./prompt-input.js";

export type QueuePreviewInput = {
  items: PromptSubmitPayload[];
  holdDrain: boolean;
  editIndex: number;
  width: number;
};

/** Build stacked queue preview above the prompt (dim text, header when non-empty). */
export function buildQueuePreviewText(input: QueuePreviewInput): string {
  const { items, holdDrain, editIndex, width } = input;
  if (items.length === 0 && !holdDrain) {
    return "";
  }

  const lines: string[] = [];

  if (holdDrain) {
    lines.push(
      `${GUTTER}${clr.dim(
        `editing #${editIndex + 1} — ↑ next queued · Esc cancel · Enter save`
      )}`
    );
  }

  if (items.length > 0) {
    lines.push(`${GUTTER}${clr.dim("Queued messages")}`);
  }

  const contIndent = "   ";

  for (let i = 0; i < items.length; i++) {
    const text = items[i]!.displayMessage.trim();
    if (!text) continue;
    const active = holdDrain && i === editIndex;
    const marker = active ? clr.dim(`> ${i + 1} `) : clr.dim(`${i + 1} `);
    const firstAvail = Math.max(8, innerWidth(width) - visibleWidth(marker));
    const wrapped = wrapTextWithAnsi(text, firstAvail);
    const contAvail = Math.max(8, innerWidth(width) - visibleWidth(contIndent));

    if (wrapped.length === 0) {
      lines.push(truncateGutterLine(`${GUTTER}${marker}`, width));
      continue;
    }

    lines.push(truncateGutterLine(`${GUTTER}${marker}${clr.dim(wrapped[0]!)}`, width));
    for (let j = 1; j < wrapped.length; j++) {
      for (const sub of wrapTextWithAnsi(wrapped[j]!, contAvail)) {
        lines.push(truncateGutterLine(`${GUTTER}${contIndent}${clr.dim(sub)}`, width));
      }
    }
  }

  if (lines.length === 0 && holdDrain) {
    return `${GUTTER}${clr.dim(`editing #${editIndex + 1} — ↑ next queued · Esc cancel · Enter save`)}`;
  }

  return lines.join("\n");
}
