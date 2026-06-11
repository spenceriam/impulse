import { describe, expect, test } from "bun:test";
import { QuestionEvents } from "../src/bus/events.js";
import { Bus } from "../src/bus/index.js";
import { Tool } from "../src/tools/registry.js";
import "../src/tools/init.js";
import { QUESTION_TOPIC_HARD_LIMIT, rejectQuestion } from "../src/tools/question.js";

function makeQuestion(topic: string) {
  return {
    topic,
    question: `Question for ${topic}?`,
    options: [
      { label: "A", description: "Option A" },
      { label: "B", description: "Option B" },
    ],
  };
}

describe("question topic cap", () => {
  test("rejects more than hard limit topics", async () => {
    const questions = Array.from({ length: QUESTION_TOPIC_HARD_LIMIT + 1 }, (_, i) =>
      makeQuestion(`T${i + 1}`)
    );
    const result = await Tool.execute("question", { questions });
    expect(result.success).toBe(false);
    expect(result.output).toContain("Too many topics");
    expect(result.output).toContain(`Max ${QUESTION_TOPIC_HARD_LIMIT} per call`);
    expect(result.output).toContain("prefer 1-3");
  });

  test("asks all topics within limit (no truncation)", async () => {
    const questions = Array.from({ length: 5 }, (_, i) => makeQuestion(`T${i + 1}`));
    const asked: string[] = [];

    const unsub = Bus.subscribe((event) => {
      if (event.type !== QuestionEvents.Asked.name) return;
      const payload = event.properties as { questions: Array<{ topic: string }> };
      asked.push(...payload.questions.map((q) => q.topic));
      rejectQuestion();
    });

    const result = await Tool.execute("question", { questions });
    unsub();

    expect(asked).toHaveLength(5);
    expect(asked).toEqual(questions.map((q) => q.topic));
    expect(result.output).not.toContain("only the first 3");
  });
});
