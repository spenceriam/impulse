import { BusEvent } from "./bus";
import z from "zod";

const TodoSchema = z.object({
  id: z.string().describe("Unique identifier for the todo item"),
  content: z.string().describe("Brief description of the task"),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"])
    .describe("Current status of the task"),
  priority: z.enum(["high", "medium", "low"])
    .describe("Priority level of the task"),
});

export const TodoEvents = {
  Updated: BusEvent.define(
    "todo.updated",
    z.object({
      sessionID: z.string(),
      todos: z.array(TodoSchema),
    })
  ),
};

export const SessionEvents = {
  Updated: BusEvent.define(
    "session.updated",
    z.object({
      id: z.string(),
    })
  ),

  Deleted: BusEvent.define(
    "session.deleted",
    z.object({
      id: z.string(),
    })
  ),

  Status: BusEvent.define(
    "session.status",
    z.object({
      sessionID: z.string(),
      status: z.enum(["idle", "working", "compacting"]),
    })
  ),
};

export const MessageEvents = {
  Updated: BusEvent.define(
    "message.updated",
    z.object({
      id: z.string(),
    })
  ),

  Removed: BusEvent.define(
    "message.removed",
    z.object({
      sessionID: z.string(),
      messageID: z.string(),
    })
  ),
};

export const McpEvents = {
  StatusChanged: BusEvent.define(
    "mcp.status",
    z.object({
      server: z.string(),
      status: z.enum(["connected", "failed", "disabled"]),
      error: z.string().optional(),
    })
  ),
};
