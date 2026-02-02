import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { Todo } from "../session/todo";

const DESCRIPTION = `Create or update the session todo list.

Required: todos array with id, content, status, priority.
See docs/tools/todo-write.md for usage rules.`;

const TodoWriteSchema = z.object({
  todos: z.array(z.object({
    id: z.string(),
    content: z.string(),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
    priority: z.enum(["high", "medium", "low"]),
  })),
});

type TodoWriteInput = z.infer<typeof TodoWriteSchema>;

export const todoWrite: Tool<TodoWriteInput> = Tool.define(
  "todo_write",
  DESCRIPTION,
  TodoWriteSchema,
  async (input: TodoWriteInput): Promise<ToolResult> => {
    try {
      await Todo.update(input.todos as Todo[]);

      const incompleteCount = input.todos.filter(
        (t) => t.status !== "completed" && t.status !== "cancelled"
      ).length;

      return {
        success: true,
        output: `Todo list updated. ${incompleteCount} tasks remaining.`,
        metadata: {
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
