import { visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { clr } from "./ansi-theme.js";
import { GUTTER, innerWidth } from "./gutter.js";
import type { PromptSubmitPayload } from "./prompt-input.js";
import { userTranscriptText } from "./prompt-input.js";

export type QueuePreviewInput = {
  items: PromptSubmitPayload[];
  holdDrain: boolean;
  editIndex: number;
  width: number;
};

const MAX_PREVIEW_LINES_PER_ITEM = 3;
const contIndent = "   ";

function queueItemDisplayText(item: PromptSubmitPayload): { text: string; moreLines: number } {
  const full = userTranscriptText(item).trim();
  if (!full) return { text: "", moreLines: 0 };
  const lines = full.split("\n");
  if (lines.length <= MAX_PREVIEW_LINES_PER_ITEM) {
    return { text: full, moreLines: 0 };
  }
  return {
    text: lines.slice(0, MAX_PREVIEW_LINES_PER_ITEM).join("\n"),
    moreLines: lines.length - MAX_PREVIEW_LINES_PER_ITEM,
  };
}

function pushWrappedQueueLines(
  lines: string[],
  prefix: string,
  text: string,
  width: number
): void {
  const firstAvail = Math.max(8, innerWidth(width) - visibleWidth(prefix));
  const wrapped = wrapTextWithAnsi(text, firstAvail);
  const contAvail = Math.max(8, innerWidth(width) - visibleWidth(contIndent));

  if (wrapped.length === 0) {
    lines.push(`${GUTTER}${prefix}`);
    return;
  }

  lines.push(`${GUTTER}${prefix}${clr.dim(wrapped[0]!)}`);
  for (let j = 1; j < wrapped.length; j++) {
    for (const sub of wrapTextWithAnsi(wrapped[j]!, contAvail)) {
      lines.push(`${GUTTER}${contIndent}${clr.dim(sub)}`);
    }
  }
}

/** Build stacked queue preview above the prompt (dim text, header when non-empty). */
export function buildQueuePreviewText(input: QueuePreviewInput): string {
  const { items, holdDrain, editIndex, width } = input;
  if (items.length === 0 && !holdDrain) {
    return "";
  }

  const lines: string[] = [];

  if (holdDrain) {
    const hint = `editing #${editIndex + 1} — Enter save · empty Enter delete · Esc keep original · ↑ next queued`;
    for (const hl of wrapTextWithAnsi(hint, innerWidth(width))) {
      lines.push(`${GUTTER}${clr.dim(hl)}`);
    }
  }

  let queueHeaderAdded = false;

  for (let i = 0; i < items.length; i++) {
    const { text, moreLines } = queueItemDisplayText(items[i]!);
    if (!text) continue;
    if (!queueHeaderAdded) {
      lines.push(`${GUTTER}${clr.dim("Queued messages")}`);
      queueHeaderAdded = true;
    }
    const active = holdDrain && i === editIndex;
    const marker = active ? clr.dim(`> ${i + 1} `) : clr.dim(`${i + 1} `);
    pushWrappedQueueLines(lines, marker, text, width);
    if (moreLines > 0) {
      lines.push(`${GUTTER}${contIndent}${clr.dim(`… ${moreLines} more lines`)}`);
    }
  }

  if (lines.length === 0 && holdDrain) {
    const hint = `editing #${editIndex + 1} — Enter save · empty Enter delete · Esc keep original`;
    return `${GUTTER}${clr.dim(hint)}`;
  }

  return lines.join("\n");
}
