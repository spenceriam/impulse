import { describe, expect, test } from "bun:test";
import { QuestionOverlay } from "../src/cli/components/question-overlay";

describe("QuestionOverlay", () => {
  test("selects on enter, submits after review", () => {
    const overlay = new QuestionOverlay({
      context: undefined,
      questions: [
        {
          topic: "Platform",
          question: "Which platform should I use?",
          options: [
            { label: "Windows", description: "Use Windows" },
            { label: "macOS", description: "Use macOS" },
          ],
        },
      ],
    });

    let answers: string[][] | null = null;
    overlay.onSubmit = (value) => {
      answers = value;
    };

    // First Enter: selects (no advance)
    overlay.handleInput("\r");
    expect(answers).toBeNull();
    // Second Enter: advance to review (single question)
    overlay.handleInput("\r");
    expect(answers).toBeNull();
    // Third Enter: submit from review
    overlay.handleInput("\r");
    expect(answers).toEqual([["Windows"]]);
  });

  test("esc aborts the overlay", () => {
    const overlay = new QuestionOverlay({
      context: undefined,
      questions: [
        {
          topic: "Platform",
          question: "Which platform should I use?",
          options: [{ label: "Windows", description: "Use Windows" }],
        },
      ],
    });

    let aborted = false;
    overlay.onAbort = () => {
      aborted = true;
    };

    overlay.handleInput("\x1b");
    expect(aborted).toBe(true);
  });

  test("renders radio markers and no numeric hotkeys", () => {
    const overlay = new QuestionOverlay({
      context: undefined,
      questions: [
        {
          topic: "Platform",
          question: "Which platform should I use?",
          options: [
            { label: "Windows", description: "Use Windows" },
            { label: "macOS", description: "Use macOS" },
          ],
        },
      ],
    });

    const rendered = overlay.render(100).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    expect(rendered).toContain("> ( ) Windows");
    expect(rendered).toContain("  ( ) macOS");
    expect(rendered).not.toContain("[1]");
    expect(rendered).not.toContain("[0]");
  });

  test("numeric keys do not submit hidden shortcuts", () => {
    const overlay = new QuestionOverlay({
      context: undefined,
      questions: [
        {
          topic: "Platform",
          question: "Which platform should I use?",
          options: [
            { label: "Windows", description: "Use Windows" },
            { label: "macOS", description: "Use macOS" },
          ],
        },
      ],
    });

    let answers: string[][] | null = null;
    overlay.onSubmit = (value) => {
      answers = value;
    };

    overlay.handleInput("2");
    expect(answers).toBeNull();
  });

  test("space selects single-choice radio without submitting", () => {
    const overlay = new QuestionOverlay({
      context: undefined,
      questions: [
        {
          topic: "Platform",
          question: "Which platform should I use?",
          options: [
            { label: "Windows", description: "Use Windows" },
            { label: "macOS", description: "Use macOS" },
          ],
        },
      ],
    });

    let answers: string[][] | null = null;
    overlay.onSubmit = (value) => {
      answers = value;
    };

    overlay.handleInput(" ");
    expect(answers).toBeNull();

    const rendered = overlay.render(100).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    expect(rendered).toContain("> (•) Windows");
  });
});
