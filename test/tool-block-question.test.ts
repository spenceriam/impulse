import { describe, expect, test } from "bun:test";
import { ToolBlock } from "../src/cli/components/tool-block.js";

describe("ToolBlock question row", () => {
  test("running row shows missing questions when args are invalid", () => {
    const block = new ToolBlock("question", { context: "context only, no questions key" });
    const line = block.render(100)[0]!;
    expect(line).toContain("missing questions array");
    expect(line).not.toContain("clarifying");
  });

  test("running row shows topic tabs not waiting placeholder", () => {
    const block = new ToolBlock("question", {
      questions: [
        { topic: "Location", question: "Where?", options: [{ label: "A", description: "a" }] },
        { topic: "Scope", question: "How much?", options: [{ label: "B", description: "b" }] },
      ],
    });
    const line = block.render(100)[0]!;
    expect(line).toContain("Location");
    expect(line).toContain("Scope");
    expect(line).not.toContain("waiting for your answer");
  });

  test("done row shows topic answers after user responds", () => {
    const block = new ToolBlock("question", {
      questions: [{ topic: "Location", question: "Where?", options: [{ label: "A", description: "a" }] }],
    });
    block.setDone(
      {
        success: true,
        output: "User responded:\nLocation: In repo",
        metadata: {
          type: "question",
          questions: [
            {
              topic: "Location",
              question: "Where?",
              options: ["In repo"],
              answers: ["In repo"],
            },
          ],
        },
      },
      61_000,
      { collapsed: true }
    );
    const rendered = block.render(120).join("\n");
    expect(rendered).toContain("Location: In repo");
    expect(rendered).not.toContain("waiting for your answer");
    expect(rendered).not.toContain("clarifying");
  });
});
