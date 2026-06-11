import { describe, expect, test } from "bun:test";
import { PromptHistory } from "../src/cli/prompt-history.js";

describe("PromptHistory", () => {
  test("caps at 20 entries", () => {
    const h = new PromptHistory();
    for (let i = 0; i < 25; i++) {
      h.push(`entry-${i}`);
    }
    expect(h.size()).toBe(20);
    expect(h.previous()).toBe("entry-24");
  });

  test("dedupes consecutive identical entries", () => {
    const h = new PromptHistory();
    h.push("same");
    h.push("same");
    expect(h.size()).toBe(1);
  });

  test("draft save and jump-down restore", () => {
    const h = new PromptHistory();
    h.push("older");
    h.push("newer");
    h.saveDraft("draft text");
    expect(h.previous()).toBe("newer");
    expect(h.getDraft()).toBe("draft text");
    expect(h.takeDraft()).toBe("draft text");
    expect(h.isBrowsing()).toBe(false);
  });

  test("takeDraft returns null when not browsing", () => {
    const h = new PromptHistory();
    h.saveDraft("draft");
    expect(h.takeDraft()).toBeNull();
  });

  test("push clears draft", () => {
    const h = new PromptHistory();
    h.saveDraft("draft");
    h.previous();
    h.push("submitted");
    expect(h.getDraft()).toBeNull();
  });

  test("loadEntries trims to cap", () => {
    const h = new PromptHistory();
    const entries = Array.from({ length: 30 }, (_, i) => `e-${i}`);
    h.loadEntries(entries);
    expect(h.size()).toBe(20);
    expect(h.previous()).toBe("e-29");
  });
});
