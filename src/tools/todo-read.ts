import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { Todo } from "../session/todo";

const DESCRIPTION = `Read the current session todo list.

No parameters. See docs/tools/todo-read.md for usage guidance.`;

const TodoReadSchema = z.object({});

type TodoReadInput = z.infer<typeof TodoReadSchema>;

export const todoRead: Tool<TodoReadInput> = Tool.define(
  "todo_read",
  DESCRIPTION,
  TodoReadSchema,
  async (): Promise<ToolResult> => {
    try {
      const todos = await Todo.get();

      const total = todos.length;
      const remaining = todos.filter(
        (t) => t.status !== "completed" && t.status !== "cancelled"
      ).length;

      if (todos.length === 0) {
        return {
          success: true,
          output: "No todos found for this session.",
          metadata: {
            type: "todo",
            source: "read",
            todos: [],
            total,
            remaining,
          },
        };
      }

      const todoLines = todos.map((todo) => {
        const statusIcon: string = {
          pending: "[ ]",
          in_progress: "[>]",
          completed: "[x]",
          cancelled: "[-]",
        }[todo.status];

        return `${statusIcon} ${todo.content}`;
      });

      const groupedTodos = todos.reduce(
        (acc, todo) => {
          const status = todo.status;
          if (!acc[status]) {
            acc[status] = [];
          }
          acc[status].push(todo);
          return acc;
        },
        {} as Record<string, Todo[]>
      );

      const statusCounts = Object.entries(groupedTodos).map(
        ([status, items]) => `${status}: ${items.length}`
      );

      return {
        success: true,
        output: `${statusCounts.join(" | ")}\n${todoLines.join("\n")}`,
        metadata: {
          type: "todo",
          source: "read",
          todos,
          total,
          remaining,
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
