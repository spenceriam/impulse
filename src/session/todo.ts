import { z } from "zod";
import { Bus, TodoEvents } from "../bus";
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
    const token = SessionManager.captureCurrentSessionMutation(scopeId);
    if (!token) return;

    await SessionManager.runCurrentSessionMutation(token, async (mutation) => {
      if (!mutation.isCurrent()) return;
      await Storage.write(["todo", scopeId], todos, {
        canCommit: mutation.isCurrent,
        sessionID: scopeId,
      });
      if (!mutation.isCurrent()) return;

      const updated = await mutation.update({ todos });
      if (!updated || !mutation.isCurrent()) return;
      Bus.publish(TodoEvents.Updated, {
        sessionID: scopeId,
        todos,
        sessionGeneration: token.generation,
      });
    });
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
