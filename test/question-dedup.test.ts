import { describe, expect, test } from "bun:test";
import {
  normalizeQuestionTopic,
  partitionQuestionsByPriorAnswers,
  priorAnsweredQuestionsFromSession,
  questionAnswerKey,
} from "../src/tools/question-dedup.js";
import type { Message } from "../src/session/store.js";

describe("question dedup", () => {
  test("normalizes topic names for comparison", () => {
    expect(normalizeQuestionTopic("Location")).toBe("location");
    expect(normalizeQuestionTopic("Test  folder")).toBe("test folder");
  });

  test("builds answer keys from topic and question text", () => {
    expect(questionAnswerKey("Cleanup action", "What should we delete?")).not.toBe(
      questionAnswerKey("Cleanup action", "Delete all 8 folders?")
    );
  });

  test("parses prior answers from linked assistant tool calls", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_1",
            tool: "question",
            arguments: {
              questions: [
                { topic: "Location", question: "Where?", options: [] },
              ],
            },
          },
        ],
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        role: "tool",
        content: "User responded:\nLocation: Sandboxed in repo",
        tool_call_id: "call_1",
        timestamp: "2026-01-01T00:00:01.000Z",
      },
    ];
    const prior = priorAnsweredQuestionsFromSession(messages);
    expect(prior.byAnswerKey.get(questionAnswerKey("Location", "Where?"))).toEqual([
      "Sandboxed in repo",
    ]);
  });

  test("partitions only when topic and question text both match", () => {
    const prior = {
      byAnswerKey: new Map([
        [questionAnswerKey("Location", "Where?"), ["Sandboxed in repo"]],
      ]),
    };
    const { unanswered, cachedAnswers } = partitionQuestionsByPriorAnswers(
      [
        { topic: "Location", question: "Where?" },
        { topic: "Location", question: "How deep?" },
        { topic: "Depth", question: "How deep?" },
      ],
      prior
    );
    expect(unanswered).toHaveLength(2);
    expect(unanswered.map((q) => q.question)).toEqual(["How deep?", "How deep?"]);
    expect(cachedAnswers).toEqual([["Sandboxed in repo"]]);
  });
});
