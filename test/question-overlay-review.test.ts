import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import { QuestionOverlay } from "../src/cli/components/question-overlay.js";
import { OVERLAY_SCROLL_FOOTER } from "../src/cli/components/overlay-scroll-region.js";

function makeQuestion(topic: string) {
  return {
    topic,
    question: `Question for ${topic}?`,
    options: [
      { label: "A", description: "Option A" },
      { label: "B", description: "Option B" },
    ],
  };
}

function advanceToReview(overlay: QuestionOverlay, topicCount: number): void {
  for (let index = 0; index < topicCount; index += 1) {
    overlay.handleInput("\r");
    overlay.handleInput("\r");
  }
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

describe("QuestionOverlay review screen", () => {
  test("clamps to maxHeight with bottom border and scroll footer when review overflows", () => {
    const overlay = new QuestionOverlay({
      context: undefined,
      questions: Array.from({ length: 5 }, (_, i) => makeQuestion(`T${i + 1}`)),
    });
    advanceToReview(overlay, 5);

    const maxHeight = 14;
    overlay.setMaxHeight(maxHeight);
    const rendered = overlay.render(100);

    expect(rendered).toHaveLength(maxHeight);
    expect(stripAnsi(rendered[rendered.length - 1]!)).toContain("└");
    expect(stripAnsi(rendered[rendered.length - 2]!)).toContain(OVERLAY_SCROLL_FOOTER);
  });

  test("arrow-down scroll changes visible review body", () => {
    const overlay = new QuestionOverlay({
      context: undefined,
      questions: Array.from({ length: 5 }, (_, i) => makeQuestion(`T${i + 1}`)),
    });
    advanceToReview(overlay, 5);
    overlay.setMaxHeight(14);

    const before = overlay.render(100);
    overlay.handleInput("\x1b[B");
    const after = overlay.render(100);

    expect(before[2]).not.toBe(after[2]);
  });

  test("no scroll footer when review fits within maxHeight", () => {
    const overlay = new QuestionOverlay({
      context: undefined,
      questions: [makeQuestion("Only")],
    });
    advanceToReview(overlay, 1);
    overlay.setMaxHeight(40);

    const rendered = overlay.render(100);
    const footer = stripAnsi(rendered[rendered.length - 2] ?? "");
    expect(footer).not.toContain(OVERLAY_SCROLL_FOOTER);
    expect(footer).toContain("Esc go back");
  });
});
