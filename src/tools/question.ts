import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { Bus } from "../bus";
import { QuestionEvents } from "../bus/events";

/**
 * Question Option - a single choice option
 */
const QuestionOptionSchema = z.object({
  label: z.string().describe("Display text (1-5 words, concise)"),
  description: z.string().describe("Explanation of choice"),
});

/**
 * Question - a single question with options, grouped by topic
 */
const QuestionSchema = z.object({
  topic: z.string().max(20).describe("Topic/category name shown as tab (max 20 chars, e.g. 'Project setup', 'UI stack')"),
  question: z.string().describe("Complete question text"),
  options: z.array(QuestionOptionSchema).describe("Available choices (user can also type custom answer)"),
  multiple: z.boolean().optional().describe("Allow selecting multiple choices"),
});

/**
 * Question Tool Input Schema
 * Maximum 3 questions (topics) per call - use follow-up calls for more
 */
const MAX_QUESTIONS_PER_CALL = 3;

const QuestionToolSchema = z.object({
  context: z.string().optional().describe("Brief explanation shown in header of why clarification is needed"),
  questions: z.array(QuestionSchema).min(1).describe("Questions to ask (max 3 topics per call)"),
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
const QUESTION_TIMEOUT_MS = 10 * 60 * 1000;

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

Provide up to 3 topics per call. See docs/tools/question.md for examples.`;

export const questionTool: Tool<QuestionToolInput> = Tool.define(
  "question",
  DESCRIPTION,
  QuestionToolSchema,
  async (input: QuestionToolInput): Promise<ToolResult> => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      if (pendingResolver) {
        return {
          success: false,
          output: "A question is already pending. Wait for the user to answer it before asking another question.",
        };
      }

      const questions =
        input.questions.length > MAX_QUESTIONS_PER_CALL
          ? input.questions.slice(0, MAX_QUESTIONS_PER_CALL)
          : input.questions;
      const truncatedCount = input.questions.length - questions.length;

      // Create a promise that will be resolved by the UI
      const answersPromise = new Promise<string[][]>((resolve, reject) => {
        pendingResolver = resolve;
        pendingRejecter = reject;
      });

      timeoutId = setTimeout(() => {
        rejectQuestion(new Error("Question timed out waiting for user response"));
      }, QUESTION_TIMEOUT_MS);

      // Publish event to notify UI to show the question overlay
      Bus.publish(QuestionEvents.Asked, {
        context: input.context,
        questions,
      });

      // Wait for user to answer (UI will call resolveQuestion or rejectQuestion)
      const answers = await answersPromise;

      // Format answers for the AI
      const formattedAnswers = questions.map((q, i) => {
        const selected = answers[i] || [];
        return `${q.topic}: ${selected.join(", ") || "(no selection)"}`;
      });
      const truncationNote =
        truncatedCount > 0
          ? `\nNote: Received ${input.questions.length} topics; only the first ${MAX_QUESTIONS_PER_CALL} were asked.`
          : "";

      return {
        success: true,
        output: `User responded:\n${formattedAnswers.join("\n")}${truncationNote}`,
        metadata: {
          type: "question",
          context: input.context,
          questions: questions.map((question, index) => ({
            topic: question.topic,
            question: question.question,
            options: question.options.map((option) => option.label),
            answers: answers[index] ?? [],
          })),
          ...(truncatedCount > 0
            ? {
                truncatedTopicCount: truncatedCount,
                requestedTopicCount: input.questions.length,
                askedTopicCount: questions.length,
              }
            : {}),
        },
      };
    } catch (error) {
      if (pendingResolver || pendingRejecter) {
        // Ensure globals are cleared when anything fails before the UI responds.
        rejectQuestion(new Error("Question flow reset due to internal error"));
      }
      if (error instanceof Error && error.message === "Question cancelled by user") {
        return {
          success: false,
          output: "User cancelled the question. Proceed without this information or ask differently.",
        };
      }
      if (error instanceof Error && error.message.includes("timed out")) {
        return {
          success: false,
          output: "Question timed out waiting for user input. Continue without this information or ask again.",
        };
      }

      return {
        success: false,
        output: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
);
