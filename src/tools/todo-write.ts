import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { Todo } from "../session/todo";
import { readFileSync } from "fs";

const DESCRIPTION = readFileSync(
  new URL("./todo-write.txt", import.meta.url),
  "utf-8"
);

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
