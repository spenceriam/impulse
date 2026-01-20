import { z } from "zod";
import { CommandRegistry, CommandDefinition } from "./registry";
import { SessionManager } from "../session/manager";
import { CheckpointManager } from "../session/checkpoint";
import { CompactManager } from "../session/compact";
import { GLM_MODELS, MODES } from "../constants";

const UndoArgsSchema = z.object({
  index: z.number().optional(),
});

const RedoArgsSchema = z.object({
  index: z.number().optional(),
});

const CompactArgsSchema = z.object({
  force: z.boolean().optional(),
});

const ModelArgsSchema = z.object({
  model: z.string(),
});

const ModeArgsSchema = z.object({
  mode: z.string(),
});

async function handleUndo(args: Record<string, unknown>) {
  const parsed = UndoArgsSchema.parse(args);
  const sessionID = SessionManager.getCurrentSessionID();

  if (!sessionID) {
    return {
      success: false,
      error: "No active session",
    };
  }

  const checkpoints = await CheckpointManager.listCheckpoints(sessionID);

  if (checkpoints.length === 0) {
    return {
      success: false,
      error: "No checkpoints available",
    };
  }

  let targetIndex: number;

  if (parsed.index !== undefined) {
    targetIndex = parsed.index;
  } else {
    targetIndex = Math.max(0, checkpoints.length - 2);
  }

  const success = await CheckpointManager.undoToCheckpoint(
    sessionID,
    targetIndex
  );

  if (success) {
    return {
      success: true,
      output: `Undone to checkpoint ${targetIndex}`,
    };
  }

  return {
    success: false,
    error: "Failed to undo to checkpoint",
  };
}

async function handleRedo(args: Record<string, unknown>) {
  const parsed = RedoArgsSchema.parse(args);
  const sessionID = SessionManager.getCurrentSessionID();

  if (!sessionID) {
    return {
      success: false,
      error: "No active session",
    };
  }

  const checkpoints = await CheckpointManager.listCheckpoints(sessionID);

  if (checkpoints.length === 0) {
    return {
      success: false,
      error: "No checkpoints available",
    };
  }

  let targetIndex: number;

  if (parsed.index !== undefined) {
    targetIndex = parsed.index;
  } else {
    targetIndex = checkpoints.length - 1;
  }

  const success = await CheckpointManager.redoToCheckpoint(
    sessionID,
    targetIndex
  );

  if (success) {
    return {
      success: true,
      output: `Redone to checkpoint ${targetIndex}`,
    };
  }

  return {
    success: false,
    error: "Failed to redo to checkpoint",
  };
}

async function handleCompact(args: Record<string, unknown>) {
  const parsed = CompactArgsSchema.parse(args);
  const sessionID = SessionManager.getCurrentSessionID();

  if (!sessionID) {
    return {
      success: false,
      error: "No active session",
    };
  }

  if (parsed.force || (await CompactManager.shouldCompact(sessionID))) {
    const result = await CompactManager.compact(sessionID);

    if (result.compacted) {
      return {
        success: true,
        output: `Compacted session: removed ${result.removedCount} messages, kept ${result.newMessageCount}`,
      };
    }

    return {
      success: true,
      output: "Session already within size limits",
    };
  }

  return {
    success: false,
    error: "Session does not need compaction. Use /compact --force to force",
  };
}

async function handleModel(args: Record<string, unknown>) {
  const parsed = ModelArgsSchema.parse(args);

  if (!GLM_MODELS.includes(parsed.model as (typeof GLM_MODELS)[number])) {
    return {
      success: false,
      error: `Invalid model. Valid models: ${GLM_MODELS.join(", ")}`,
    };
  }

  await SessionManager.update({ model: parsed.model });

  return {
    success: true,
    output: `Model changed to ${parsed.model}`,
  };
}

async function handleMode(args: Record<string, unknown>) {
  const parsed = ModeArgsSchema.parse(args);

  const modeUpper = parsed.mode.toUpperCase();
  if (!MODES.includes(modeUpper as (typeof MODES)[number])) {
    return {
      success: false,
      error: `Invalid mode. Valid modes: ${MODES.join(", ")}`,
    };
  }

  const mode = parsed.mode.toUpperCase();
  await SessionManager.update({ mode });

  return {
    success: true,
    output: `Mode changed to ${mode}`,
  };
}

async function handleThink() {
  return {
    success: true,
    output: "Thinking mode toggle not yet implemented",
  };
}

export function registerUtilityCommands(): void {
  const commands: CommandDefinition[] = [
    {
      name: "undo",
      category: "utility",
      description: "Undo to previous checkpoint",
      args: UndoArgsSchema,
      handler: handleUndo,
      examples: ["/undo", "/undo --index 5"],
    },
    {
      name: "redo",
      category: "utility",
      description: "Redo to forward checkpoint",
      args: RedoArgsSchema,
      handler: handleRedo,
      examples: ["/redo", "/redo --index 8"],
    },
    {
      name: "compact",
      category: "utility",
      description: "Compact session with AI summarization",
      args: CompactArgsSchema,
      handler: handleCompact,
      examples: ["/compact", "/compact --force"],
    },
    {
      name: "model",
      category: "utility",
      description: "Switch GLM model",
      args: ModelArgsSchema,
      handler: handleModel,
      examples: ["/model glm-4.7", "/model glm-4.5-air"],
    },
    {
      name: "mode",
      category: "utility",
      description: "Switch AI mode",
      args: ModeArgsSchema,
      handler: handleMode,
      examples: ["/mode AUTO", "/mode AGENT", "/mode PLANNER"],
    },
    {
      name: "think",
      category: "utility",
      description: "Toggle thinking mode",
      handler: handleThink,
      examples: ["/think"],
    },
  ];

  for (const command of commands) {
    CommandRegistry.register(command);
  }
}
