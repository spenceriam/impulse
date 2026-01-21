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
 * Question - a single question with options
 */
const QuestionSchema = z.object({
  question: z.string().describe("Complete question text"),
  header: z.string().max(12).describe("Very short label (max 12 chars)"),
  options: z.array(QuestionOptionSchema).describe("Available choices"),
  multiple: z.boolean().optional().describe("Allow selecting multiple choices"),
});

/**
 * Question Tool Input Schema
 */
const QuestionToolSchema = z.object({
  questions: z.array(QuestionSchema).describe("Questions to ask"),
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

const DESCRIPTION = `Ask the user questions with structured options.

Use this tool when you need to:
- Gather user preferences or requirements
- Clarify ambiguous instructions  
- Get decisions on implementation choices
- Offer choices about what direction to take

Notes:
- Users can always select "Other" to provide custom text input
- Answers are returned as arrays of labels per question
- Set multiple: true to allow selecting more than one option
- Keep headers to max 12 characters
- Keep option labels concise (1-5 words)`;

export const questionTool: Tool<QuestionToolInput> = Tool.define(
  "question",
  DESCRIPTION,
  QuestionToolSchema,
  async (input: QuestionToolInput): Promise<ToolResult> => {
    try {
      // Create a promise that will be resolved by the UI
      const answersPromise = new Promise<string[][]>((resolve, reject) => {
        pendingResolver = resolve;
        pendingRejecter = reject;
      });

      // Publish event to notify UI to show the question overlay
      Bus.publish(QuestionEvents.Asked, {
        questions: input.questions,
      });

      // Wait for user to answer (UI will call resolveQuestion or rejectQuestion)
      const answers = await answersPromise;

      // Format answers for the AI
      const formattedAnswers = input.questions.map((q, i) => {
        const selected = answers[i] || [];
        return `${q.header}: ${selected.join(", ") || "(no selection)"}`;
      });

      return {
        success: true,
        output: `User responded:\n${formattedAnswers.join("\n")}`,
        metadata: {
          answers,
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
