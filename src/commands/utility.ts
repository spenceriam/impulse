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
  model: z.string().optional(),
  _: z.array(z.string()).optional(), // Positional args
});

const ModeArgsSchema = z.object({
  mode: z.string().optional(),
  _: z.array(z.string()).optional(), // Positional args
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
  
  // Get model from named arg or first positional arg
  const modelArg = parsed.model || (parsed._ && parsed._[0]);

  // If no model specified, show available models
  if (!modelArg) {
    const currentSession = SessionManager.getCurrentSession();
    const currentModel = currentSession?.model || "glm-4.7";
    
    const modelList = GLM_MODELS.map(m => {
      const isCurrent = m === currentModel;
      const displayName = m.toUpperCase().replace("GLM-", "GLM-");
      return isCurrent ? `  * ${displayName} (current)` : `    ${displayName}`;
    }).join("\n");
    
    return {
      success: true,
      output: `Available models:\n${modelList}\n\nUsage: /model <model-name>`,
    };
  }

  // Normalize model name (accept GLM-4.7 or glm-4.7)
  const normalizedModel = modelArg.toLowerCase();
  
  if (!GLM_MODELS.includes(normalizedModel as (typeof GLM_MODELS)[number])) {
    return {
      success: false,
      error: `Invalid model: ${modelArg}\nValid models: ${GLM_MODELS.map(m => m.toUpperCase().replace("GLM-", "GLM-")).join(", ")}`,
    };
  }

  await SessionManager.update({ model: normalizedModel });

  return {
    success: true,
    output: `Model changed to ${normalizedModel.toUpperCase().replace("GLM-", "GLM-")}`,
  };
}

async function handleMode(args: Record<string, unknown>) {
  const parsed = ModeArgsSchema.parse(args);
  
  // Get mode from named arg or first positional arg
  const modeArg = parsed.mode || (parsed._ && parsed._[0]);

  // If no mode specified, show available modes
  if (!modeArg) {
    const currentSession = SessionManager.getCurrentSession();
    const currentMode = currentSession?.mode || "AUTO";
    
    const modeDescriptions: Record<string, string> = {
      AUTO: "AI decides based on prompt",
      AGENT: "Full execution + looper skill",
      PLANNER: "Research + documentation",
      "PLAN-PRD": "Quick PRD via Q&A",
      DEBUG: "7-step systematic debugging",
    };
    
    const modeList = MODES.map(m => {
      const isCurrent = m === currentMode;
      const desc = modeDescriptions[m] || "";
      return isCurrent ? `  * ${m} - ${desc} (current)` : `    ${m} - ${desc}`;
    }).join("\n");
    
    return {
      success: true,
      output: `Available modes:\n${modeList}\n\nUsage: /mode <mode-name>`,
    };
  }

  const modeUpper = modeArg.toUpperCase();
  if (!MODES.includes(modeUpper as (typeof MODES)[number])) {
    return {
      success: false,
      error: `Invalid mode: ${modeArg}\nValid modes: ${MODES.join(", ")}`,
    };
  }

  await SessionManager.update({ mode: modeUpper });

  return {
    success: true,
    output: `Mode changed to ${modeUpper}`,
  };
}

async function handleThink() {
  return {
    success: true,
    output: "Thinking mode toggle not yet implemented",
  };
}

async function handleExpress() {
  // This is handled specially in App.tsx to use the Express context
  // This handler is just a placeholder for the command registry
  return {
    success: true,
    output: "Express mode toggled (handled by UI)",
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
    {
      name: "express",
      category: "utility",
      description: "Toggle Express mode (auto-approve all permissions)",
      handler: handleExpress,
      examples: ["/express"],
    },
  ];

  for (const command of commands) {
    CommandRegistry.register(command);
  }
}
