import { describe, expect, test } from "bun:test";
import { QuestionOverlay } from "../src/cli/components/question-overlay";

describe("QuestionOverlay", () => {
  test("submits the selected option on enter", () => {
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
});
