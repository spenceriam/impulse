import { z } from "zod";
import { CommandRegistry, CommandDefinition } from "./registry";
import { SessionManager } from "../session/manager";
import { CheckpointManager } from "../session/checkpoint";
import { CompactManager } from "../session/compact";
import { MODES, getModelDisplayName, normalizeMode } from "../constants";
import { load as loadConfig } from "../util/config";
import { Bus, ModeEvents } from "../bus";

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
    // Manual compact - will generate "what next?" prompt
    const result = await CompactManager.compact(sessionID, true);

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
  const config = await loadConfig();
  
  // Get model from named arg or first positional arg
  const modelArg = parsed.model || (parsed._ && parsed._[0]);

  // If no model specified, show available models
  if (!modelArg) {
    const currentSession = SessionManager.getCurrentSession();
    const currentModel = currentSession?.model || config.defaultModel;
    const configuredProviders = Object.entries(config.providers ?? {})
      .filter(([, value]) => value?.apiKey || value?.baseUrl)
      .map(([provider]) => provider)
      .sort();
    const providerLine = configuredProviders.length > 0
      ? configuredProviders.join(", ")
      : config.defaultProvider;
    
    return {
      success: true,
      output: [
        `Current model: ${getModelDisplayName(currentModel)}`,
        `Default provider: ${config.defaultProvider}`,
        `Configured providers: ${providerLine}`,
        "",
        "Usage: /model <provider/model>",
        "Examples: /model ollama/deepseek-v4-pro, /model z.ai/glm-4.7, /model openai/gpt-4o-mini",
      ].join("\n"),
    };
  }

  const normalizedModel = normalizeModelInput(modelArg, config.defaultProvider);

  await SessionManager.update({ model: normalizedModel });

  return {
    success: true,
    output: `Model changed to ${getModelDisplayName(normalizedModel)}`,
  };
}

function normalizeModelInput(model: string, defaultProvider: string): string {
  const trimmed = model.trim();
  if (trimmed.includes("/")) return trimmed;
  return defaultProvider === "z.ai" && trimmed.toLowerCase().startsWith("glm-")
    ? trimmed.toLowerCase()
    : `${defaultProvider}/${trimmed}`;
}

async function handleMode(args: Record<string, unknown>) {
  const parsed = ModeArgsSchema.parse(args);
  
  // Get mode from named arg or first positional arg
  const modeArg = parsed.mode || (parsed._ && parsed._[0]);

  // If no mode specified, show available modes
  if (!modeArg) {
    const currentSession = SessionManager.getCurrentSession();
    const currentMode = normalizeMode(currentSession?.mode);
    
    const modeDescriptions: Record<string, string> = {
      AGENT: "Full execution mode",
      EXPLORE: "Read-only understanding",
      PLAN: "Planning and documentation",
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
  const allowedInputs = new Set<string>([
    ...MODES,
    "AUTO",
    "AGENT",
    "PLANNER",
    "PLAN-PRD",
  ]);
  if (!allowedInputs.has(modeUpper)) {
    return {
      success: false,
      error: `Invalid mode: ${modeArg}\nValid modes: ${MODES.join(", ")}\nLegacy aliases: AUTO, AGENT, PLANNER, PLAN-PRD`,
    };
  }

  const normalizedMode = normalizeMode(modeUpper);

  await SessionManager.update({ mode: normalizedMode });
  Bus.publish(ModeEvents.Changed, {
    mode: normalizedMode,
    reason: "User changed mode via /mode",
  });

  return {
    success: true,
    output: modeUpper === normalizedMode
      ? `Mode changed to ${normalizedMode}`
      : `Mode changed to ${normalizedMode} (mapped from ${modeUpper})`,
  };
}

async function handleThink() {
  return {
    success: true,
    output: "Use /think in the CLI to toggle reasoning, or /reason for explicit levels.",
  };
}

async function handleThinkingBlocks() {
  return {
    success: true,
    output: "Thinking block visibility is always shown in the CLI during active turns.",
  };
}

async function handleExpress() {
  return {
    success: true,
    output: "Use /express in the CLI to toggle auto-approve permissions.",
  };
}

async function handleEngage() {
  return {
    success: true,
    output: "Use /engage in the CLI to toggle high-autonomy mode (AGENT + express).",
  };
}

async function handleVerbose() {
  return {
    success: true,
    output: "Verbose tool display is always enabled in the CLI tool blocks.",
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
      description: "Switch model",
      args: ModelArgsSchema,
      handler: handleModel,
      examples: ["/model ollama/deepseek-v4-pro", "/model z.ai/glm-4.7"],
    },
    {
      name: "mode",
      category: "utility",
      description: "Switch AI mode",
      args: ModeArgsSchema,
      handler: handleMode,
      examples: ["/mode AGENT", "/mode EXPLORE", "/mode PLAN", "/mode DEBUG"],
    },
    {
      name: "think",
      category: "utility",
      description: "Toggle thinking mode",
      handler: handleThink,
      examples: ["/think"],
    },
    {
      name: "thinking-blocks",
      aliases: ["toggle-thinking-blocks", "thinking"],
      category: "utility",
      description: "Toggle visibility of thinking blocks in chat",
      handler: handleThinkingBlocks,
      examples: ["/thinking-blocks", "/thinking"],
    },
    {
      name: "express",
      category: "utility",
      description: "Toggle Express mode (auto-approve all permissions)",
      handler: handleExpress,
      examples: ["/express"],
    },
    {
      name: "engage",
      category: "utility",
      description: "Toggle Engage mode (WORK + express + deeper autonomous loop)",
      handler: handleEngage,
      examples: ["/engage"],
    },
    {
      name: "verbose",
      aliases: ["details"],
      category: "utility",
      description: "Toggle verbose tool display (shows expanded details)",
      handler: handleVerbose,
      examples: ["/verbose", "/details"],
    },
  ];

  for (const command of commands) {
    CommandRegistry.register(command);
  }
}
