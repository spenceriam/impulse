import { afterEach, describe, expect, test } from "bun:test";
import { questionTool, rejectQuestion, resolveQuestion, type QuestionToolInput } from "../src/tools/question";

const baseQuestion: QuestionToolInput["questions"][number] = {
  topic: "Scope",
  question: "Proceed?",
  options: [
    { label: "Yes", description: "Continue" },
    { label: "No", description: "Stop" },
  ],
};

afterEach(() => {
  // Ensure no pending question leaks across tests.
  rejectQuestion(new Error("test cleanup"));
});

describe("question tool safeguards", () => {
  test("truncates to first 3 topics instead of failing", async () => {
    const input: QuestionToolInput = {
      context: "test",
      questions: [
        { ...baseQuestion, topic: "T1" },
        { ...baseQuestion, topic: "T2" },
        { ...baseQuestion, topic: "T3" },
        { ...baseQuestion, topic: "T4" },
      ],
    };

    const responsePromise = questionTool.handler(input);
    resolveQuestion([["Yes"], ["Yes"], ["No"]]);

    const result = await responsePromise;
    expect(result.success).toBe(true);
    expect(result.output).toContain("only the first 3 were asked");
  });

  test("rejects overlapping question calls while one is pending", async () => {
    const firstPromise = questionTool.handler({
      context: "first",
      questions: [{ ...baseQuestion, topic: "First" }],
    });

    const secondResult = await questionTool.handler({
      context: "second",
      questions: [{ ...baseQuestion, topic: "Second" }],
    });

    expect(secondResult.success).toBe(false);
    expect(secondResult.output).toContain("already active");

    resolveQuestion([["Yes"]]);
    await firstPromise;
  });
});
