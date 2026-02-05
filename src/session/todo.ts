import { z } from "zod";
import { Storage } from "../storage";
import { SessionManager } from "./manager";

export const TodoSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  priority: z.enum(["high", "medium", "low"]),
});

export type Todo = z.infer<typeof TodoSchema>;

export namespace Todo {
  export function getScopeId(): string {
    return SessionManager.getCurrentSessionID() ?? "";
  }

  export async function get(scopeId: string = getScopeId()): Promise<Todo[]> {
    if (!scopeId) return [];
    try {
      const data = await Storage.read<Todo[]>(["todo", scopeId]);
      return data ?? [];
    } catch {
      return [];
    }
  }

  export async function update(todos: Todo[], scopeId: string = getScopeId()): Promise<void> {
    if (!scopeId) return;
    await Storage.write(["todo", scopeId], todos);
    
    const { TodoEvents } = await import("../bus/events");
    const { Bus } = await import("../bus");
    Bus.publish(TodoEvents.Updated, { sessionID: scopeId, todos });

    const currentSessionId = SessionManager.getCurrentSessionID();
    if (currentSessionId) {
      try {
        await SessionManager.update({ todos });
      } catch {
        // Ignore session sync errors; storage + bus already updated
      }
    }
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
