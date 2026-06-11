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
- Before ending your turn: every item must be completed or cancelled — never leave stale in_progress/pending for work you already finished`;

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
