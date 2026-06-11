import type { Message } from "../session/store.js";

export function normalizeQuestionTopic(topic: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Dedup key: same tab label can host a different question later in the session. */
export function questionAnswerKey(topic: string, question: string): string {
  return `${normalizeQuestionTopic(topic)}\0${normalizeQuestionTopic(question)}`;
}

function parseAnswerLines(content: string): Map<string, string[]> {
  const answers = new Map<string, string[]>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("Note:") || trimmed.startsWith("Context:")) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const topic = trimmed.slice(0, colon).trim();
    const answer = trimmed.slice(colon + 1).trim();
    if (!topic || !answer || answer === "(no selection)") continue;
    answers.set(normalizeQuestionTopic(topic), answer.split(",").map((s) => s.trim()));
  }
  return answers;
}

/** Link assistant question tool_calls to tool results (topic + question text → answers). */
export function priorAnsweredQuestionsFromSession(messages: Message[]): {
  byAnswerKey: Map<string, string[]>;
} {
  const byAnswerKey = new Map<string, string[]>();

  const resultByCallId = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "tool" && message.tool_call_id) {
      resultByCallId.set(message.tool_call_id, message.content ?? "");
    }
  }

  for (const message of messages) {
    if (message.role !== "assistant" || !message.tool_calls) continue;
    for (const call of message.tool_calls) {
      if (call.tool !== "question" || !call.id) continue;
      const result = resultByCallId.get(call.id);
      if (!result) continue;
      if (!result.includes("User responded:") && !result.includes("User already answered")) {
        continue;
      }

      const answerLines = parseAnswerLines(result);
      const args = call.arguments;
      const questions = args["questions"];
      if (!Array.isArray(questions)) continue;

      for (const entry of questions) {
        if (typeof entry !== "object" || entry === null) continue;
        const topic = typeof entry.topic === "string" ? entry.topic : "";
        const questionText = typeof entry.question === "string" ? entry.question : "";
        if (!topic || !questionText) continue;
        const answers = answerLines.get(normalizeQuestionTopic(topic)) ?? [];
        if (answers.length === 0) continue;
        byAnswerKey.set(questionAnswerKey(topic, questionText), answers);
      }
    }
  }

  return { byAnswerKey };
}

export function lookupPriorAnswer(
  question: { topic: string; question: string },
  prior: { byAnswerKey: Map<string, string[]> }
): string[] | undefined {
  return prior.byAnswerKey.get(questionAnswerKey(question.topic, question.question));
}

export function partitionQuestionsByPriorAnswers<T extends { topic: string; question: string }>(
  questions: T[],
  prior: { byAnswerKey: Map<string, string[]> }
): { unanswered: T[]; cachedAnswers: string[][] } {
  const unanswered: T[] = [];
  const cachedAnswers: string[][] = [];

  for (const question of questions) {
    const existing = lookupPriorAnswer(question, prior);
    if (existing && existing.length > 0) {
      cachedAnswers.push(existing);
    } else {
      unanswered.push(question);
    }
  }

  return { unanswered, cachedAnswers };
}
