import { z } from "zod";
import { Storage } from "../storage";

export const TodoSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  priority: z.enum(["high", "medium", "low"]),
});

export type Todo = z.infer<typeof TodoSchema>;

export namespace Todo {
  const sessionID = "default";

  export async function get(): Promise<Todo[]> {
    try {
      const data = await Storage.read<Todo[]>(["todo", sessionID]);
      return data ?? [];
    } catch {
      return [];
    }
  }

  export async function update(todos: Todo[]): Promise<void> {
    await Storage.write(["todo", sessionID], todos);
    
    const { TodoEvents } = await import("../bus/events");
    const { Bus } = await import("../bus");
    Bus.publish(TodoEvents.Updated, { sessionID, todos });
  }

  export function create(
    content: string,
    priority: "high" | "medium" | "low" = "medium"
  ): Todo {
    return {
      id: crypto.randomUUID(),
      content,
      status: "pending",
      priority,
    };
  }
}
