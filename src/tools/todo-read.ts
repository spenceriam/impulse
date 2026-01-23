import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { Todo } from "../session/todo";

const DESCRIPTION = `Use this tool to read the current to-do list for the session. This tool should be used proactively and frequently to ensure that you are aware of the status of the current task list. You should make use of this tool as often as possible, especially in the following situations:

- At the beginning of conversations to see what's pending
- Before starting new tasks to prioritize work
- When the user asks about previous tasks or plans
- Whenever you're uncertain about what to do next
- After completing tasks to update your understanding of remaining work
- After every few messages to ensure you're on track

Usage:
- This tool takes no parameters. Leave the input empty.
- Returns a list of todo items with their status, priority, and content
- Use this information to track progress and plan next steps
- If no todos exist yet, an empty list will be returned`;

const TodoReadSchema = z.object({});

type TodoReadInput = z.infer<typeof TodoReadSchema>;

export const todoRead: Tool<TodoReadInput> = Tool.define(
  "todo_read",
  DESCRIPTION,
  TodoReadSchema,
  async (): Promise<ToolResult> => {
    try {
      const todos = await Todo.get();

      if (todos.length === 0) {
        return {
          success: true,
          output: "No todos found for this session.",
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
          total: todos.length,
          byStatus: statusCounts,
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
