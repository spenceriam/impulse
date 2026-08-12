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
      sessionGeneration: z.number().int().nonnegative().optional(),
    })
  ),
};

export const SessionEvents = {
  Created: BusEvent.define(
    "session.created",
    z.object({
      sessionID: z.string(),
      session: z.any(),
    })
  ),

  Updated: BusEvent.define(
    "session.updated",
    z.object({
      sessionID: z.string(),
      session: z.any(),
      sessionGeneration: z.number().int().nonnegative().optional(),
    })
  ),

  Deleted: BusEvent.define(
    "session.deleted",
    z.object({
      sessionID: z.string(),
    })
  ),

  Status: BusEvent.define(
    "session.status",
    z.object({
      sessionID: z.string(),
      status: z.enum(["idle", "working", "compacting"]),
    })
  ),

  Checkpoint: BusEvent.define(
    "session.checkpoint",
    z.object({
      sessionID: z.string(),
      action: z.enum(["create", "undo", "redo"]),
      toIndex: z.number().optional(),
    })
  ),

  Compacted: BusEvent.define(
    "session.compacted",
    z.object({
      sessionID: z.string(),
      summary: z.string(),
      removedCount: z.number(),
      isManual: z.boolean().optional(),
      continuationPrompt: z.string().optional(),
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

// Question option schema for the question tool
const QuestionOptionSchema = z.object({
  label: z.string().describe("Display text (1-5 words, concise)"),
  description: z.string().optional().describe("Explanation of choice"),
});

// Question schema for the question tool (v0.19.0 - topic-based tabs)
const QuestionSchema = z.object({
  topic: z.string().max(60).describe("Topic/category name shown as tab (max 60 chars)"),
  question: z.string().describe("Complete question text"),
  options: z.array(QuestionOptionSchema).describe("Available choices"),
  multiple: z.boolean().optional().describe("Allow selecting multiple choices"),
});

export const QuestionEvents = {
  Asked: BusEvent.define(
    "question.asked",
    z.object({
      context: z.string().optional().describe("Brief explanation of why clarification is needed"),
      questions: z.array(QuestionSchema),
    })
  ),
};

export const ExecutionHandoffEvents = {
  Asked: BusEvent.define(
    "execution-handoff.asked",
    z.object({
      id: z.string(),
      request: z.string(),
      description: z.string(),
      choices: z.tuple([
        z.literal("Preview safely"),
        z.literal("Switch to AGENT"),
        z.literal("Stay in ASK"),
      ]),
      recommended: z.literal("Preview safely"),
    })
  ),
};

export const HeaderEvents = {
  Updated: BusEvent.define(
    "header.updated",
    z.object({
      title: z.string().describe("Concise description of current task/conversation"),
    })
  ),
};

export const ModeEvents = {
  Changed: BusEvent.define(
    "mode.changed",
    z.object({
      mode: z.enum(["ASK", "AGENT"]),
      reason: z.string().optional().describe("Brief explanation of why mode was changed"),
    })
  ),
  TransitionFailed: BusEvent.define(
    "mode.transition.failed",
    z.object({
      mode: z.literal("AGENT"),
      requestedMode: z.literal("ASK"),
      failedParticipantIds: z.array(z.string()),
      stoppedJobs: z.number(),
      stoppedShells: z.number(),
      reason: z.string().optional().describe("Brief explanation of why mode was requested"),
    })
  ),
};

export const UpdateEvents = {
  Available: BusEvent.define(
    "update.available",
    z.object({
      currentVersion: z.string(),
      latestVersion: z.string(),
      updateCommand: z.string(),
    })
  ),
};

// Queue message schema
const QueueMessageSchema = z.object({
  id: z.string().describe("Unique identifier for the queued message"),
  content: z.string().describe("The message content"),
  timestamp: z.number().describe("Unix timestamp when message was queued"),
});



export const SubagentEvents = {
  Progress: BusEvent.define(
    "subagent.progress",
    z.object({
      type: z.enum(["text", "tool", "thinking", "status"]),
      content: z.string(),
      durationMs: z.number().optional(),
      parentToolCallId: z.string(),
    })
  ),
};

export const BranchEvents = {
  Changed: BusEvent.define(
    "branch.changed",
    z.object({})
  ),
};

export const QueueEvents = {
  Added: BusEvent.define(
    "queue.added",
    z.object({
      message: QueueMessageSchema,
    })
  ),
  Removed: BusEvent.define(
    "queue.removed",
    z.object({
      id: z.string(),
    })
  ),
  Updated: BusEvent.define(
    "queue.updated",
    z.object({
      messages: z.array(QueueMessageSchema),
    })
  ),
  Sending: BusEvent.define(
    "queue.sending",
    z.object({
      id: z.string(),
    })
  ),
  Sent: BusEvent.define(
    "queue.sent",
    z.object({
      id: z.string(),
    })
  ),
};
