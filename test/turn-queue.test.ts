import { describe, expect, test } from "bun:test";
import { TurnQueueManager } from "../src/cli/turn-queue.js";
import { buildQueuePreviewText } from "../src/cli/queue-preview.js";
import type { PromptSubmitPayload } from "../src/cli/prompt-input.js";

const nonempty = (p: PromptSubmitPayload) => p.displayMessage.trim().length > 0;

function payload(text: string): PromptSubmitPayload {
  return {
    apiText: text,
    displayMessage: text,
    orderedImages: [],
    segments: [],
  };
}

describe("TurnQueueManager", () => {
  test("enqueue rejects empty and respects max size", () => {
    const q = new TurnQueueManager(2, nonempty);
    expect(q.enqueue(payload("  "))).toBe("empty");
    expect(q.enqueue(payload("a"))).toBe("ok");
    expect(q.enqueue(payload("b"))).toBe("ok");
    expect(q.enqueue(payload("c"))).toBe("full");
    expect(q.length).toBe(2);
  });

  test("pruneHead drops blank heads", () => {
    const q = new TurnQueueManager(5, nonempty);
    q.enqueue(payload(" "));
    q.enqueue(payload("keep"));
    expect(q.pruneHead()).toBe(true);
    expect(q.shift()?.displayMessage).toBe("keep");
  });

  test("edit cycle restores on cancel and saves on commit", () => {
    const q = new TurnQueueManager(5, nonempty);
    q.enqueue(payload("one"));
    q.enqueue(payload("two"));

    expect(q.beginEdit()).toBe(true);
    expect(q.editingPayload()?.displayMessage).toBe("one");

    q.commitEdit(payload("one-edited"));
    expect(q.at(0)?.displayMessage).toBe("one-edited");
    expect(q.isHoldDrain).toBe(false);

    expect(q.beginEdit()).toBe(true);
    expect(q.beginEdit()).toBe(true);
    expect(q.editingPayload()?.displayMessage).toBe("two");

    q.cancelEdit();
    expect(q.at(1)?.displayMessage).toBe("two");
    expect(q.isHoldDrain).toBe(false);
  });

  test("deleteAt removes item at index and ends edit when queue empty", () => {
    const q = new TurnQueueManager(5, nonempty);
    q.enqueue(payload("one"));
    q.enqueue(payload("two"));
    expect(q.beginEdit()).toBe(true);
    expect(q.deleteAt(0)).toBe(true);
    expect(q.length).toBe(1);
    expect(q.isHoldDrain).toBe(false);
    expect(q.at(0)?.displayMessage).toBe("two");
  });

  test("clearHead removes first item", () => {
    const q = new TurnQueueManager(5, nonempty);
    q.enqueue(payload("first"));
    q.enqueue(payload("second"));
    expect(q.clearHead()).toBe(true);
    expect(q.at(0)?.displayMessage).toBe("second");
    expect(q.clearHead()).toBe(true);
    expect(q.clearHead()).toBe(false);
  });
});

describe("buildQueuePreviewText", () => {
  test("includes Queued messages header and dim styling (no user cyan)", () => {
    const text = buildQueuePreviewText({
      items: [payload("fix greeter test"), payload("run bun test")],
      holdDrain: false,
      editIndex: 0,
      width: 80,
    });
    expect(text).toContain("Queued messages");
    expect(text).toContain("fix greeter test");
    expect(text).toContain("1 ");
    expect(text).not.toMatch(/\x1b\[36m/);
  });

  test("omits header when all queued messages are blank", () => {
    const text = buildQueuePreviewText({
      items: [payload("  "), payload("\n")],
      holdDrain: false,
      editIndex: 0,
      width: 80,
    });
    expect(text).not.toContain("Queued messages");
  });

  test("long queued text wraps without horizontal ellipsis", () => {
    const long = "fix the failing grep test and ".repeat(8);
    const text = buildQueuePreviewText({
      items: [payload(long)],
      holdDrain: false,
      editIndex: 0,
      width: 80,
    });
    expect(text.split("\n").length).toBeGreaterThan(1);
    expect(text).not.toContain("…");
    expect(text).toContain("fix the failing");
  });

  test("expands pasted queue preview text", () => {
    const text = buildQueuePreviewText({
      items: [
        {
          apiText: "line one\nline two\nline three",
          displayMessage: "[Pasted 3 lines  30 chars #1]",
          orderedImages: [],
          segments: [
            {
              kind: "paste",
              display: "[Pasted 3 lines  30 chars #1]",
              content: "line one\nline two\nline three",
            },
          ],
        },
      ],
      holdDrain: false,
      editIndex: 0,
      width: 80,
    });
    expect(text).toContain("line one");
    expect(text).not.toContain("[Pasted");
  });

  test("returns empty when queue is empty and not editing", () => {
    expect(
      buildQueuePreviewText({
        items: [],
        holdDrain: false,
        editIndex: 0,
        width: 80,
      })
    ).toBe("");
  });
});
