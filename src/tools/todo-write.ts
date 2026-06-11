import { z } from "zod";
import { batchCompletionNote, countPendingToCompleted } from "../agent/repeat-notes";
import { Tool, ToolResult } from "./registry";
import { Todo } from "../session/todo";

const DESCRIPTION = `The session todo list is live progress UI shown to the user — keep statuses truthful in real time.

Required: todos array with id, content, status, priority.

Rules:
- Mark a todo in_progress BEFORE starting work on it (exactly ONE in_progress at a time)
- Mark completed IMMEDIATELY after finishing each item — never batch completions at end of turn
- Only mark completed when actually done (verified); if blocked, keep in_progress and add a follow-up todo
- Before ending your turn: every item must be completed or cancelled — never leave stale in_progress/pending for work you already finished
- Do not resubmit a relabeled or reworded list when only wording changed — update statuses in place instead`;

const TodoWriteSchema = z.object({
  todos: z.array(z.object({
    id: z.string(),
    content: z.string(),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
    priority: z.enum(["high", "medium", "low"]),
  })),
});

type TodoWriteInput = z.infer<typeof TodoWriteSchema>;

function todoSemanticKey(todo: { content: string; status: string }): string {
  return `${todo.content}\0${todo.status}`;
}

function todosSemanticallyEqual(
  current: Array<{ content: string; status: string }>,
  incoming: Array<{ content: string; status: string }>
): boolean {
  if (current.length !== incoming.length) return false;
  const a = current.map(todoSemanticKey).sort();
  const b = incoming.map(todoSemanticKey).sort();
  return a.every((key, index) => key === b[index]);
}

function normalizeTodoTokens(content: string): string[] {
  return content
    .replace(/^T\d+:\s*/i, "")
    .replace(/[^\w\s]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function contentTokenOverlap(a: string, b: string): number {
  const ta = normalizeTodoTokens(a);
  const tb = normalizeTodoTokens(b);
  if (ta.length === 0 && tb.length === 0) return 1;
  if (ta.length === 0 || tb.length === 0) return 0;
  const setB = new Set(tb);
  let shared = 0;
  for (const token of ta) {
    if (setB.has(token)) shared++;
  }
  return shared / Math.max(ta.length, tb.length);
}

/** Same item count + status multiset + high per-item wording overlap (relabeled lists). */
function isCosmeticTodoRewrite(
  current: Array<{ content: string; status: string }>,
  incoming: Array<{ content: string; status: string }>
): boolean {
  if (current.length !== incoming.length || current.length === 0) return false;
  if (todosSemanticallyEqual(current, incoming)) return false;

  const statusA = current.map((t) => t.status).sort();
  const statusB = incoming.map((t) => t.status).sort();
  if (!statusA.every((s, i) => s === statusB[i])) return false;

  const overlaps = current.map((c, i) => contentTokenOverlap(c.content, incoming[i]!.content));
  const avg = overlaps.reduce((sum, v) => sum + v, 0) / overlaps.length;
  return avg >= 0.6;
}

export const todoWrite: Tool<TodoWriteInput> = Tool.define(
  "todo_write",
  DESCRIPTION,
  TodoWriteSchema,
  async (input: TodoWriteInput): Promise<ToolResult> => {
    try {
      const current = await Todo.get();
      if (todosSemanticallyEqual(current, input.todos)) {
        return {
          success: true,
          output: "Todos unchanged.",
          metadata: {
            type: "todo",
            source: "write",
            unchanged: true,
            todos: input.todos,
            total: input.todos.length,
            remaining: input.todos.filter(
              (t) => t.status !== "completed" && t.status !== "cancelled"
            ).length,
          },
        };
      }

      const cosmetic = isCosmeticTodoRewrite(current, input.todos);

      await Todo.update(input.todos as Todo[]);

      const incompleteCount = input.todos.filter(
        (t) => t.status !== "completed" && t.status !== "cancelled"
      ).length;

      const batchNote =
        batchCompletionNote(countPendingToCompleted(current, input.todos)) ?? "";

      return {
        success: true,
        output: `Todo list updated. ${incompleteCount} tasks remaining.${batchNote}`,
        metadata: {
          type: "todo",
          source: "write",
          ...(cosmetic ? { cosmetic: true } : {}),
          todos: input.todos,
          total: input.todos.length,
          remaining: incompleteCount,
        },
      };
    } catch (error) {
      if (error instanceof Error) {
        return {
          success: false,
          output: error.message,
        };
      }

      return {
        success: false,
        output: String(error),
      };
    }
  }
);
