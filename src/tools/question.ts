import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { Bus } from "../bus";
import { QuestionEvents } from "../bus/events";
import { SessionManager } from "../session/manager.js";
import { fileError } from "../util/logger.js";
import { currentExecutionContext } from "../execution/context.js";
import {
  partitionQuestionsByPriorAnswers,
  priorAnsweredQuestionsFromSession,
  questionAnswerKey,
} from "./question-dedup.js";

export const QUESTION_TOPIC_HARD_LIMIT = 8;

/**
 * Question Option - a single choice option
 */
const QuestionOptionSchema = z.object({
  label: z.string().describe("Display text (1-5 words, concise)"),
  description: z.string().optional().describe("Explanation of choice"),
});

/**
 * Question - a single question with options, grouped by topic
 */
const QuestionSchema = z.object({
  topic: z
    .string()
    .transform((s) => s.trim().slice(0, 60))
    .pipe(z.string().min(1))
    .describe("Topic/category name shown as tab (max 60 chars, e.g. 'Project setup', 'UI stack')"),
  question: z.string().describe("Complete question text"),
  options: z.array(QuestionOptionSchema).describe("Available choices (user can also type custom answer)"),
  multiple: z.boolean().optional().describe("Allow selecting multiple choices"),
});

/**
 * Question Tool Input Schema
 */
const QuestionToolSchema = z.object({
  context: z.string().optional().describe("Brief explanation shown in header of why clarification is needed"),
  questions: z
    .array(QuestionSchema)
    .min(1)
    .describe("Questions to ask (prefer 1-3 topics; hard limit 8)"),
});

export type QuestionOption = z.infer<typeof QuestionOptionSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type QuestionToolInput = z.infer<typeof QuestionToolSchema>;

/**
 * Question Tool Output - returned to the AI
 */
export interface QuestionToolOutput {
  answers: string[][]; // Selected labels per question
}

// Store for pending question promises
// The UI will resolve these when user answers
let pendingResolver: ((answers: string[][]) => void) | null = null;
let pendingRejecter: ((error: Error) => void) | null = null;

/**
 * Resolve pending question with user's answers
 * Called by the UI when user submits answers
 */
export function resolveQuestion(answers: string[][]): void {
  if (pendingResolver) {
    const resolver = pendingResolver;
    pendingResolver = null;
    pendingRejecter = null;
    resolver(answers);
  }
}

/**
 * Reject pending question (user cancelled)
 * Called by the UI when user presses Esc
 */
export function rejectQuestion(error?: Error): void {
  if (pendingRejecter) {
    const rejecter = pendingRejecter;
    pendingResolver = null;
    pendingRejecter = null;
    rejecter(error || new Error("Question cancelled by user"));
  }
}

/**
 * Check if there's a pending question
 */
export function hasPendingQuestion(): boolean {
  return pendingResolver !== null;
}

const DESCRIPTION = `Ask structured questions via the question overlay.

Prefer 1-3 topics per call for focus; all topics you send are asked. See docs/tools/question.md for examples.`;

export const questionTool: Tool<QuestionToolInput> = Tool.define(
  "question",
  DESCRIPTION,
  QuestionToolSchema,
  async (input: QuestionToolInput): Promise<ToolResult> => {
    try {
      const runtime = currentExecutionContext()?.runtime;
      if (runtime) {
        const answers: string[][] = [];
        for (const question of input.questions) {
          const response = await runtime.requestQuestion({
            prompt: `${question.topic}: ${question.question}`,
            choices: question.options.map((option, index) => ({
              id: String(index),
              label: option.label,
              ...(option.description ? { description: option.description } : {}),
            })),
            ...(question.multiple === undefined ? {} : { multiple: question.multiple }),
          });
          if (!response) {
            return {
              success: false,
              output: "User cancelled the question. Proceed without this information or ask differently.",
            };
          }
          answers.push(response);
        }
        return {
          success: true,
          output: `User responded:\n${input.questions.map((question, index) =>
            `${question.topic}: ${(answers[index] ?? []).join(", ") || "(no selection)"}`
          ).join("\n")}`,
          metadata: {
            type: "question",
            context: input.context,
            questions: input.questions.map((question, index) => ({
              topic: question.topic,
              question: question.question,
              options: question.options.map((option) => option.label),
              answers: answers[index] ?? [],
            })),
          },
        };
      }

      if (hasPendingQuestion()) {
        return {
          success: false,
          output: "A question is already active. Wait for it to complete before asking another question.",
        };
      }

      if (input.questions.length > QUESTION_TOPIC_HARD_LIMIT) {
        return {
          success: false,
          output: `Too many topics (${input.questions.length}). Max ${QUESTION_TOPIC_HARD_LIMIT} per call; prefer 1-3 focused topics per call.`,
        };
      }

      const questions = input.questions;

      const sessionMessages = SessionManager.getCurrentSession()?.messages ?? [];
      const prior = priorAnsweredQuestionsFromSession(sessionMessages);

      const { unanswered, cachedAnswers } = partitionQuestionsByPriorAnswers(
        questions,
        prior
      );

      if (unanswered.length === 0) {
        const formattedAnswers = questions.map((q, i) => {
          const selected = cachedAnswers[i] ?? [];
          return `${q.topic}: ${selected.join(", ")}`;
        });
        return {
          success: true,
          output: `User already answered these topics earlier in this session:\n${formattedAnswers.join("\n")}`,
          metadata: {
            type: "question",
            context: input.context,
            deduplicated: true,
            questions: questions.map((question, index) => ({
              topic: question.topic,
              question: question.question,
              options: question.options.map((option) => option.label),
              answers: cachedAnswers[index] ?? [],
            })),
          },
        };
      }

      const questionsToAsk = unanswered;

      // Create a promise that will be resolved by the UI
      const answersPromise = new Promise<string[][]>((resolve, reject) => {
        pendingResolver = resolve;
        pendingRejecter = reject;
      });

      // Publish event to notify UI to show the question overlay
      Bus.publish(QuestionEvents.Asked, {
        context: input.context,
        questions: questionsToAsk,
      });

      // Wait for user to answer (UI will call resolveQuestion or rejectQuestion)
      const freshAnswers = await answersPromise;

      if (freshAnswers.length !== questionsToAsk.length) {
        fileError(
          `question tool answer count mismatch: expected ${questionsToAsk.length}, got ${freshAnswers.length}`
        );
      }

      const mergedAnswers: string[][] = [];
      let freshIndex = 0;
      for (const question of questions) {
        const existing = prior.byAnswerKey.get(
          questionAnswerKey(question.topic, question.question)
        );
        if (existing && existing.length > 0) {
          mergedAnswers.push(existing);
        } else {
          mergedAnswers.push(freshAnswers[freshIndex] ?? []);
          freshIndex++;
        }
      }

      // Format answers for the AI
      const formattedAnswers = questions.map((q, i) => {
        const selected = mergedAnswers[i] || [];
        return `${q.topic}: ${selected.join(", ") || "(no selection)"}`;
      });

      const skippedNote =
        cachedAnswers.length > 0
          ? `Note: ${cachedAnswers.length} topic(s) were already answered this session and were not re-asked.\n`
          : "";

      return {
        success: true,
        output: `${skippedNote}User responded:\n${formattedAnswers.join("\n")}`,
        metadata: {
          type: "question",
          context: input.context,
          deduplicatedTopics: questions.length - questionsToAsk.length,
          questions: questions.map((question, index) => ({
            topic: question.topic,
            question: question.question,
            options: question.options.map((option) => option.label),
            answers: mergedAnswers[index] ?? [],
          })),
        },
      };
    } catch (error) {
      if (error instanceof Error && error.message === "Question cancelled by user") {
        return {
          success: false,
          output: "User cancelled the question. Proceed without this information or ask differently.",
        };
      }

      return {
        success: false,
        output: error instanceof Error ? error.message : String(error),
      };
    }
  }
);
