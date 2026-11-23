import { describe, expect, test } from "bun:test";
import { QuestionOverlay } from "../src/cli/components/question-overlay.js";

const LONG_CONTEXT =
  "Fetched https://spenceriam.github.io/rules/index.md (v4bb4e09, 2026-11-12). It contains the 5-instruction operating contract, the Bug Report Standard, the Draft PR Standard, and a version footer that must all be considered before choosing what to keep.";

function overlay(context?: string): QuestionOverlay {
  return new QuestionOverlay({
    context,
    questions: [
      {
        topic: "Content scope",
        question:
          "What should the global instructions contain from the page, given that it mixes an operating contract with two standards and a footer?",
        options: [
          { label: "Full page verbatim", description: "copy exactly" },
          { label: "Contract only", description: "just the 5 instructions" },
        ],
      },
    ],
  });
}

describe("QuestionOverlay context is wrapped, not truncated (#188-class)", () => {
  test("the end of a long context survives rendering", () => {
    const rendered = overlay(LONG_CONTEXT).render(100).join("\n");
    // The last words were the part the 120-char cap used to drop.
    expect(rendered).toContain("before choosing what to keep");
  });

  test("the full context text is present across wrapped lines", () => {
    const rendered = overlay(LONG_CONTEXT)
      .render(100)
      .join(" ")
      .replace(/\s+/g, " ");
    expect(rendered).toContain("5-instruction operating contract");
    expect(rendered).toContain("version footer");
  });

  test("a long question is not cut either", () => {
    const rendered = overlay(undefined).render(100).join("\n");
    expect(rendered).toContain("two standards and a footer");
  });

  test("no context still renders the question", () => {
    const rendered = overlay(undefined).render(100).join("\n");
    expect(rendered).not.toContain("Context:");
    expect(rendered).toContain("Content scope");
  });
});
