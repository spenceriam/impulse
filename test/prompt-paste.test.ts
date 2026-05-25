import { describe, expect, test } from "bun:test";
import type { EditorTheme } from "@mariozechner/pi-tui";
import {
  PromptInput,
  buildPromptSegments,
  buildSubmitPayload,
  type PasteGroup,
} from "../src/cli/prompt-input";

const TEST_EDITOR_THEME: EditorTheme = {
  borderColor: (s: string) => s,
  selectList: {
    selectedPrefix: (s: string) => s,
    selectedText: (s: string) => s,
    description: (s: string) => s,
    scrollInfo: (s: string) => s,
    noMatch: (s: string) => s,
  },
};

function bracketedPaste(text: string): string {
  return `\x1b[200~${text}\x1b[201~`;
}

describe("PromptInput paste submission", () => {
  test("submits hidden long-paste payload instead of visible paste marker", () => {
    const input = new PromptInput(undefined, TEST_EDITOR_THEME);
    const pasted = "x".repeat(420);
    let submitted = "";

    input.onSubmit = (payload) => {
      submitted = payload.apiText;
    };

    input.handleInput(bracketedPaste(pasted));
    expect(input.render(80)[0]).toContain("[Pasted 420 chars #");

    input.handleInput("\r");

    expect(submitted).toBe(pasted);
  });

  test("submits hidden multi-line paste payload", () => {
    const input = new PromptInput(undefined, TEST_EDITOR_THEME);
    const pasted = "line one\nline two\nline three";
    let submitted = "";

    input.onSubmit = (payload) => {
      submitted = payload.apiText;
    };

    input.handleInput(bracketedPaste(pasted));
    expect(input.render(80)[0]).toContain("[Pasted 3 lines");

    input.handleInput("\r");

    expect(submitted).toBe(pasted);
  });

  test("preserves text typed around a hidden paste marker", () => {
    const input = new PromptInput(undefined, TEST_EDITOR_THEME);
    const pasted = "x".repeat(130);

    input.handleInput(bracketedPaste(pasted));
    input.handleInput(" suffix");

    expect(input.getSubmitPayload().apiText).toBe(`${pasted} suffix`);
  });

  test("preserves paste A + typed + paste B order", () => {
    const input = new PromptInput(undefined, TEST_EDITOR_THEME);
    const a = "A".repeat(130);
    const b = "B".repeat(140);

    input.handleInput(bracketedPaste(a));
    input.handleInput(" BETWEEN ");
    input.handleInput(bracketedPaste(b));

    const payload = input.getSubmitPayload();
    expect(payload.apiText).toBe(`${a} BETWEEN ${b}`);
    expect(payload.displayMessage).toContain("BETWEEN");
  });

  test("partial backspace on paste token keeps payload until token gone", () => {
    const input = new PromptInput(undefined, TEST_EDITOR_THEME);
    const pasted = "z".repeat(130);
    input.handleInput(bracketedPaste(pasted));

    const display = input.getText();
    const partial = display.slice(0, -1);
    input.setText(partial);

    expect(input.getSubmitPayload().apiText).toBe(pasted);

    input.setText("");
    expect(input.getSubmitPayload().apiText).toBe("");
  });

  test("partial backspace through marker suffix keeps payload until token gone", () => {
    const input = new PromptInput(undefined, TEST_EDITOR_THEME);
    const pasted = "z".repeat(130);
    input.handleInput(bracketedPaste(pasted));

    const display = input.getText();
    input.setText(display.slice(0, -2));

    expect(input.getSubmitPayload().apiText).toBe(pasted);
  });

  test("partial backspace on paste token with trailing typed text keeps payload", () => {
    const input = new PromptInput(undefined, TEST_EDITOR_THEME);
    const pasted = "z".repeat(130);
    input.handleInput(bracketedPaste(pasted));
    input.handleInput(" after");

    const display = input.getText();
    const marker = display.slice(0, display.indexOf(" after"));
    const partial = marker.slice(0, -1);
    input.setText(`${partial} after`);

    expect(input.getSubmitPayload().apiText).toBe(`${pasted} after`);
  });
});

describe("buildPromptSegments", () => {
  test("orders interleaved text and paste groups", () => {
    const groups: PasteGroup[] = [
      {
        display: "[Pasted 5 chars]",
        content: "HELLO",
        originalDisplay: "[Pasted 5 chars]",
        kind: "text",
      },
      {
        display: "[Pasted 3 chars]",
        content: "BYE",
        originalDisplay: "[Pasted 3 chars]",
        kind: "text",
      },
    ];
    const editor = "pre [Pasted 5 chars] mid [Pasted 3 chars] end";
    const segments = buildPromptSegments(editor, groups);
    expect(segments.map((s) => (s.kind === "text" ? s.value : s.content))).toEqual([
      "pre ",
      "HELLO",
      " mid ",
      "BYE",
      " end",
    ]);
  });

  test("removing first of two image tokens keeps second uri aligned", () => {
    const input = new PromptInput(undefined, TEST_EDITOR_THEME);
    const img1 = "data:image/png;base64,QUFB";
    const img2 = "data:image/png;base64,QkJC";

    input.handleInput(bracketedPaste(img1));
    input.handleInput(bracketedPaste(img2));
    input.setText("[Pasted image #2]");

    const images = input.getSubmitPayload().orderedImages;
    expect(images).toHaveLength(1);
    expect(images[0].uri).toBe(img2);
    expect(images[0].index).toBe(1);
  });

  test("removing first of three image tokens reindexes remaining labels", () => {
    const input = new PromptInput(undefined, TEST_EDITOR_THEME);
    const img1 = "data:image/png;base64,QUFB";
    const img2 = "data:image/png;base64,QkJC";
    const img3 = "data:image/png;base64,Q0ND";

    input.handleInput(bracketedPaste(img1));
    input.handleInput(bracketedPaste(img2));
    input.handleInput(bracketedPaste(img3));
    input.setText("[Pasted image #2][Pasted image #3]");

    expect(input.getText()).toBe("[Pasted image #1][Pasted image #2]");
    const images = input.getSubmitPayload().orderedImages;
    expect(images).toHaveLength(2);
    expect(images[0].uri).toBe(img2);
    expect(images[1].uri).toBe(img3);
  });

  test("sync after edit keeps distinct identical paste markers in order", () => {
    const input = new PromptInput(undefined, TEST_EDITOR_THEME);
    const a = "A".repeat(130);
    const b = "B".repeat(130);

    input.handleInput(bracketedPaste(a));
    input.handleInput(" BETWEEN ");
    input.handleInput(bracketedPaste(b));
    input.setText(` BETWEEN [Pasted 130 chars #2]`);

    expect(input.getSubmitPayload().apiText).toBe(` BETWEEN ${b}`);
  });

  test("maps identical display tokens to distinct paste content in order", () => {
    const marker1 = "[Pasted 130 chars #1]";
    const marker2 = "[Pasted 130 chars #2]";
    const groups: PasteGroup[] = [
      {
        display: marker1,
        content: "FIRST_PAYLOAD",
        originalDisplay: marker1,
        kind: "text",
      },
      {
        display: marker2,
        content: "SECOND_PAYLOAD",
        originalDisplay: marker2,
        kind: "text",
      },
    ];
    const editor = `a ${marker1} b ${marker2} c`;
    const segments = buildPromptSegments(editor, groups);
    expect(segments.map((s) => (s.kind === "text" ? s.value : s.content))).toEqual([
      "a ",
      "FIRST_PAYLOAD",
      " b ",
      "SECOND_PAYLOAD",
      " c",
    ]);
  });
});

describe("buildSubmitPayload", () => {
  test("displayMessage preserves tokens", () => {
    const payload = buildSubmitPayload("hi [Pasted 10 chars #1]", [
      {
        display: "[Pasted 10 chars #1]",
        content: "0123456789",
        originalDisplay: "[Pasted 10 chars #1]",
        kind: "text",
      },
    ]);
    expect(payload.displayMessage).toBe("hi [Pasted 10 chars #1]");
    expect(payload.apiText).toBe("hi 0123456789");
  });
});
