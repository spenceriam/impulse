import { describe, expect, test } from "bun:test";
import { PromptInput, textPasteLabel } from "../src/cli/prompt-input.js";

function makePrompt(): PromptInput {
  return new PromptInput({ text: "" });
}

describe("textPasteLabel (#226)", () => {
  test("single-line paste gets a numbered chars label", () => {
    expect(textPasteLabel("hello world", 1)).toBe("[Pasted 11 chars #1]");
  });

  test("multi-line paste counts normalized lines", () => {
    expect(textPasteLabel("one\ntwo\nthree", 2)).toBe("[Pasted 3 lines  13 chars #2]");
  });
});

describe("bracketed text paste (#226)", () => {
  test("a short paste is visible immediately as a numbered indicator", () => {
    const prompt = makePrompt();
    prompt.handleInput("\x1b[200~hello world\x1b[201~");
    // Synchronous: no waiting on the clipboard file-list probe.
    expect(prompt.getText()).toContain("[Pasted 11 chars #1]");
  });

  test("submitting sends the real content, not the label", () => {
    const prompt = makePrompt();
    prompt.handleInput("\x1b[200~hello world\x1b[201~");
    expect(prompt.getSubmitPayload().apiText).toBe("hello world");
  });

  test("a multi-line paste shows a line count and preserves the text", () => {
    const prompt = makePrompt();
    const content = "line one\nline two\nline three";
    prompt.handleInput(`\x1b[200~${content}\x1b[201~`);
    expect(prompt.getText()).toContain("3 lines");
    expect(prompt.getSubmitPayload().apiText).toBe(content);
  });

  test("prose containing a path is still an ordinary text paste", () => {
    const prompt = makePrompt();
    prompt.handleInput("\x1b[200~see notes in /tmp/notes.txt\x1b[201~");
    expect(prompt.getText()).toContain("[Pasted");
    expect(prompt.getSubmitPayload().apiText).toBe("see notes in /tmp/notes.txt");
  });

  test("each paste gets its own number", () => {
    const prompt = makePrompt();
    prompt.handleInput("\x1b[200~first\x1b[201~");
    prompt.handleInput("\x1b[200~second\x1b[201~");
    expect(prompt.getText()).toContain("#1");
    expect(prompt.getText()).toContain("#2");
  });
});
