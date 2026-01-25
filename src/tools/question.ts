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
const QuestionToolSchema = z.object({
  context: z.string().optional().describe("Brief explanation shown in header of why clarification is needed"),
  questions: z.array(QuestionSchema).max(3).describe("Questions to ask (max 3 topics per call)"),
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

const DESCRIPTION = `Ask the user questions with structured options, organized by topic tabs.

Use this tool when you need to:
- Gather user preferences or requirements
- Clarify ambiguous instructions  
- Get decisions on implementation choices
- Offer choices about what direction to take

IMPORTANT GUIDELINES:
- Maximum 3 topics per call (UI shows them as tabs)
- If you need more questions, make a follow-up call after receiving answers
- Each topic should have a short name (max 20 chars) like "Project setup", "UI stack", "Deployment"
- Users can always type a custom answer instead of selecting an option
- Use the 'context' field to explain WHY you're asking (shown in header)
- Keep option labels concise (1-5 words)

Example with multiple topics:
{
  "context": "Setting up your new project",
  "questions": [
    {
      "topic": "Platform",
      "question": "What platforms do you need to support?",
      "options": [
        { "label": "macOS + Linux", "description": "Unix terminals" },
        { "label": "Windows", "description": "CMD/PowerShell" },
        { "label": "Cross-platform", "description": "All of the above" }
      ]
    },
    {
      "topic": "UI Framework",
      "question": "What UI approach do you prefer?",
      "options": [
        { "label": "React-like", "description": "Component-based, declarative" },
        { "label": "Immediate mode", "description": "Redraw each frame" }
      ]
    }
  ]
}`;

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
        context: input.context,
        questions: input.questions,
      });

      // Wait for user to answer (UI will call resolveQuestion or rejectQuestion)
      const answers = await answersPromise;

      // Format answers for the AI
      const formattedAnswers = input.questions.map((q, i) => {
        const selected = answers[i] || [];
        return `${q.topic}: ${selected.join(", ") || "(no selection)"}`;
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
