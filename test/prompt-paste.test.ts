import { describe, expect, test } from "bun:test";
import { PromptInput } from "../src/cli/renderer";

function bracketedPaste(text: string): string {
  return `\x1b[200~${text}\x1b[201~`;
}

describe("PromptInput paste submission", () => {
  test("submits hidden long-paste payload instead of visible paste marker", () => {
    const input = new PromptInput();
    const pasted = "x".repeat(420);
    let submitted = "";

    input.onSubmit = () => {
      submitted = input.getSubmitValue();
    };

    input.handleInput(bracketedPaste(pasted));
    expect(input.render(80)[0]).toContain("[Pasted 420 chars]");

    input.handleInput("\r");

    expect(submitted).toBe(pasted);
  });

  test("submits hidden multi-line paste payload", () => {
    const input = new PromptInput();
    const pasted = "line one\nline two\nline three";
    let submitted = "";

    input.onSubmit = () => {
      submitted = input.getSubmitValue();
    };

    input.handleInput(bracketedPaste(pasted));
    expect(input.render(80)[0]).toContain("[Pasted 3 lines");

    input.handleInput("\r");

    expect(submitted).toBe(pasted);
  });

  test("preserves text typed around a hidden paste marker", () => {
    const input = new PromptInput();
    const pasted = "x".repeat(130);

    input.handleInput(bracketedPaste(pasted));
    input.handleInput(" suffix");

    expect(input.getSubmitValue()).toBe(`${pasted} suffix`);
  });
});
