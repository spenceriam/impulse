import { Global } from "../global";
import { SessionManager } from "../session/manager";
import fs from "fs/promises";
import path from "path";
import z from "zod";
import { writeFileAtomic } from "./atomic-write.js";
import { clearWindowsShellCache, clearWslCache } from "./windows-shell.js";

// ============================================================
// Multi-Provider Config Schema
// ============================================================

// Reasoning/thinking level — unified across all providers
// "off" = disabled; "low"/"medium"/"high" = enabled at that depth
// Binary providers (Ollama, ZAI) treat any non-"off" value as on
export type ReasoningLevel = "off" | "low" | "medium" | "high";
const ReasoningLevelSchema = z.enum(["off", "low", "medium", "high"]);

/** Main-agent thinking visibility in chat UI. */
export type ThinkingDisplay = "off" | "summary" | "full";
const ThinkingDisplaySchema = z.enum(["off", "summary", "full"]);

/** Bottom context bar verbosity. */
export type BottomBarVisual = "full" | "reduced" | "minimal" | "off";
const BottomBarVisualSchema = z.enum(["full", "reduced", "minimal", "off"]);

const ProviderKeySchema = z.object({
  /** API key for this provider */
  apiKey: z.string().optional(),
  /** Default base URL (optional — most providers have sensible defaults) */
  baseUrl: z.string().optional(),
  /** Provider type for custom endpoints: OpenAI-compatible or Anthropic-compatible */
  type: z.enum(["openai-compatible", "anthropic-compatible"]).optional(),
});

// Provider configuration per key — dynamic keys allow custom providers
const ProvidersConfigSchema = z.record(z.string(), ProviderKeySchema);

export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;

const ConfigSchema = z.object({
  /** Per-provider API keys and settings */
  providers: ProvidersConfigSchema.default({}),

  /** Default provider name (e.g. "openai", "anthropic", "z.ai", "openrouter", "groq", "gemini", "nous") */
  defaultProvider: z.string().default("ollama").describe("Which provider to use by default"),

  /** Default model — include provider prefix when ambiguous (e.g. "ollama/kimi-k2.6") */
  defaultModel: z.string().default("").describe("Default model to use"),

  /** True after user explicitly picks a model via /model or provider setup */
  modelExplicitlySet: z.boolean().default(false).describe("User chose default model"),

  /** Advisor model — optional second model for strategic guidance */
  advisorModel: z.string().optional().describe("Advisor model for strategic guidance"),

  /** Advisor mode — toggle for advisor/executor pattern */
  advisorMode: z.boolean().default(false).describe("Whether advisor mode is active"),

  /** Vision model — optional separate model for image understanding */
  visionModel: z.string().optional().describe("Vision model for image interpretation"),

  /** Vision provider key — provider configured for vision model */
  visionProvider: z.string().optional().describe("Provider key for vision model"),

  /** Vision mode — toggle for automatic image→text translation */
  visionMode: z.boolean().default(false).describe("Whether vision translation is active"),

  /** Main-agent thinking display: off | summary (Thought for…) | full stream */
  thinkingDisplay: ThinkingDisplaySchema.default("summary"),

  /** @deprecated use thinkingDisplay — migrated on load */
  showMainThinking: z.boolean().default(true).describe("Show reasoning stream in main chat"),

  /** Show thinking... progress lines inside subagent task tool rows */
  showSubagentThinking: z.boolean().default(true).describe("Show subagent thinking progress"),

  /** When true, task subagents use subagentModel instead of the main session model */
  useSubagentModel: z.boolean().default(false).describe("Use dedicated subagent model"),

  /** Model for task subagents when useSubagentModel is true (retained when toggled off) */
  subagentModel: z.string().optional().describe("Subagent model override"),

  /** Default mode: AGENT, EXPLORE, PLAN, DEBUG */
  defaultMode: z.string().default("AGENT").describe("Default agent mode"),

  /** Reasoning/thinking level for AI responses.
   * "off" = disabled; "low"/"medium"/"high" = enabled at that depth.
   * Binary providers (Ollama, ZAI) treat any non-"off" as enabled. */
  reasoningLevel: ReasoningLevelSchema.default("medium"),

  /** Default max output tokens for model responses.
   * Providers may clamp this lower; 32000 is the safe project default for cloud-hosted models. */
  maxOutputTokens: z.number().int().positive().default(32000),

  /** @deprecated use reasoningLevel instead — kept for migration */
  thinking: z.boolean().default(true).describe("Enable thinking mode (legacy)"),

  /** Whether user has seen the welcome screen */
  hasSeenWelcome: z.boolean().default(false),

  /** User profile for personalization */
  userProfile: z.object({
    /** User's display name */
    name: z.string().default(""),
    /** Response style preference */
    responsePreference: z.string().default("balanced"),
    /** Custom instructions injected into every system prompt */
    customInstructions: z.string().default(""),
  }).optional(),

  /** Experimental features — off by default until stable */
  experimental: z
    .object({
      advisor: z.boolean().default(false),
      undo: z.boolean().default(false),
      goal: z.boolean().default(false),
    })
    .default({ advisor: false, undo: false, goal: false }),

  /** Show session summary on /exit and double Ctrl+C */
  statsOnExit: z.boolean().default(false),

  /** Optional vision model override when main model lacks native vision */
  visionModelOverride: z.string().optional(),

  /** Dim one-liner for read-only tool success rows */
  compactToolOutput: z.boolean().default(true),

  /** Bottom context bar verbosity: full | reduced | minimal | off */
  bottomBarVisual: BottomBarVisualSchema.default("full"),

  /** Per-model reliability overrides when tool continuations fail */
  modelProfiles: z
    .record(
      z.string(),
      z.object({
        reasoningLevel: ReasoningLevelSchema.optional(),
        preserveReasoning: z.boolean().optional(),
      })
    )
    .optional(),

  // Legacy — kept for smooth migration; prefer providers[].apiKey
  apiKey: z.string().optional().describe("Legacy: use providers[defaultProvider].apiKey instead"),

  /**
   * Preferred shell for bash tool execution on Windows.
   * "auto" (default) = detect from parent process.
   * Other values force a specific shell regardless of detection.
   */
  preferredShell: z.enum(["auto", "powershell", "pwsh", "git-bash", "wsl", "cmd"]).default("auto"),
});

export type PreferredShell = z.infer<typeof ConfigSchema.shape.preferredShell>;

export type Config = z.infer<typeof ConfigSchema>;
export type UserProfile = NonNullable<Config["userProfile"]>;

export const configPath = path.join(Global.Path.config, "config.json");
export const configBackupPath = `${configPath}.bak`;

export class ConfigFileError extends Error {
  constructor(message: string, readonly sourcePath: string = configPath) {
    super(message);
    this.name = "ConfigFileError";
  }
}

function invalidConfigError(error: unknown, sourcePath: string = configPath): ConfigFileError {
  const detail = error instanceof z.ZodError
    ? error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
        .join("; ")
    : error instanceof Error
      ? error.message
      : String(error);
  return new ConfigFileError(
    `Invalid Impulse config at ${sourcePath}: ${detail}. Fix the file or restore ${sourcePath}.bak.`,
    sourcePath
  );
}

async function loadConfigFile(): Promise<Partial<Config>> {
  try {
    const content = await fs.readFile(configPath, "utf-8");
    try {
      const parsed = JSON.parse(content) as unknown;
      applyDefaults(parsed as Partial<Config>);
      return parsed as Partial<Config>;
    } catch (error) {
      throw invalidConfigError(error);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw e;
    }
    return {};
  }
}

// Map of well-known env var names to provider keys
const PROVIDER_ENV_VARS: Record<string, string> = {
  ZAI_API_KEY: "z.ai",
  GLM_API_KEY: "z.ai",
  OPENAI_API_KEY: "openai",
  ANTHROPIC_API_KEY: "anthropic",
  OPENROUTER_API_KEY: "openrouter",
  GROQ_API_KEY: "groq",
  GEMINI_API_KEY: "gemini",
  GOOGLE_GENERATIVE_AI_API_KEY: "gemini",
  NOUS_API_KEY: "nous",
  OLLAMA_API_KEY: "ollama",
};

async function loadEnvVars(): Promise<Partial<Config>> {
  const env: Partial<Config> = {};

  for (const [envVar, provider] of Object.entries(PROVIDER_ENV_VARS)) {
    if (process.env[envVar]) {
      env.providers = env.providers ?? {};
      (env.providers as Record<string, unknown>)[provider] = {
        apiKey: process.env[envVar],
      };
    }
  }

  // Legacy: if a Z.ai key was set, also set the top-level apiKey.
  const zaiApiKey = process.env["ZAI_API_KEY"] ?? process.env["GLM_API_KEY"];
  if (zaiApiKey) {
    env.apiKey = zaiApiKey;
  }

  return env;
}

function applyDefaults(config: Partial<Config>): Config {
  return ConfigSchema.parse(config);
}

/** Build a full Config from partial values (Zod defaults applied). */
export function createDefaultConfig(overrides?: Partial<Config>): Config {
  return applyDefaults(overrides ?? {});
}

let cachedConfig: Config | null = null;
let cachedConfigFingerprint: string | null = null;

async function configFileFingerprint(): Promise<string> {
  try {
    const stat = await fs.stat(configPath);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

/** Clear in-memory config after home migration or external config edits. */
export function invalidateConfigCache(): void {
  cachedConfig = null;
  cachedConfigFingerprint = null;
}

export async function load(options?: { refresh?: boolean }): Promise<Config> {
  const currentFingerprint = await configFileFingerprint();
  if (
    options?.refresh !== true &&
    cachedConfig !== null &&
    cachedConfigFingerprint === currentFingerprint
  ) {
    return applySessionVision(applySessionAdvisor({ ...cachedConfig }));
  }

  const fileConfig = await loadConfigFile();
  const envConfig = await loadEnvVars();
  const providerKeys = new Set([
    ...Object.keys(fileConfig.providers ?? {}),
    ...Object.keys(envConfig.providers ?? {}),
  ]);
  const providers: Record<string, unknown> = {};
  for (const key of providerKeys) {
    providers[key] = {
      ...((fileConfig.providers as Record<string, unknown> | undefined)?.[key] as object | undefined),
      ...((envConfig.providers as Record<string, unknown> | undefined)?.[key] as object | undefined),
    };
  }

  const merged = {
    ...fileConfig,
    ...envConfig,
    providers,
  };
  let parsed: Config;
  try {
    parsed = applyDefaults(merged as Partial<Config>);
  } catch (error) {
    throw invalidConfigError(error);
  }
  // Migrate showMainThinking → thinkingDisplay
  if (
    (fileConfig as { thinkingDisplay?: ThinkingDisplay }).thinkingDisplay === undefined
  ) {
    parsed.thinkingDisplay =
      fileConfig.showMainThinking === false ? "off" : "summary";
  }
  repairModelExplicitlySet(fileConfig, parsed);
  // Advisor requires experimental flag
  if (parsed.advisorMode && !isExperimentalAdvisorEnabled(parsed)) {
    parsed.advisorMode = false;
  }
  cachedConfig = parsed;
  cachedConfigFingerprint = await configFileFingerprint();
  return applySessionVision(applySessionAdvisor({ ...cachedConfig }));
}

/** Experimental advisor feature enabled in config. */
export function isExperimentalAdvisorEnabled(config: Config): boolean {
  return config.experimental?.advisor === true;
}

export function isExperimentalUndoEnabled(config: Config): boolean {
  return config.experimental?.undo === true;
}

export function isExperimentalGoalEnabled(config: Config): boolean {
  return config.experimental?.goal === true;
}

/** Session-scoped advisor: active only when toggled in-session or restored on resume. */
export function applySessionAdvisor(config: Config): Config {
  if (!isExperimentalAdvisorEnabled(config)) {
    return { ...config, advisorMode: false };
  }
  const session = SessionManager.getCurrentSession();
  if (session?.advisorMode === true) {
    return {
      ...config,
      advisorMode: true,
      advisorModel: session.advisorModel ?? config.advisorModel,
    };
  }
  return { ...config, advisorMode: false };
}

/** Session-scoped vision: active only when toggled in-session or restored on resume. */
export function applySessionVision(config: Config): Config {
  const session = SessionManager.getCurrentSession();
  if (session?.visionMode === true) {
    return {
      ...config,
      visionMode: true,
      visionModel: session.visionModel ?? config.visionModel,
    };
  }
  return { ...config, visionMode: false };
}

/**
 * Non-empty defaultModel implies the user chose a model (onboarding, /model, cli setup).
 * Repairs first-run onboarding configs that saved defaultModel without modelExplicitlySet (#80).
 */
export function repairModelExplicitlySet(
  fileConfig: Partial<Config>,
  parsed: Config
): void {
  if (fileConfig.defaultModel?.trim() && parsed.modelExplicitlySet !== true) {
    parsed.modelExplicitlySet = true;
  }
}

/** Whether the user has saved a default model (required before chat). */
export function isModelConfigured(config: Config): boolean {
  return Boolean(config.modelExplicitlySet && config.defaultModel?.trim());
}

/** Model string for task subagents (main session model unless override is enabled). */
export function resolveSubagentModel(config: Config, mainModel: string): string {
  if (config.useSubagentModel && config.subagentModel?.trim()) {
    return config.subagentModel.trim();
  }
  return mainModel.trim();
}

export async function save(config: Config): Promise<void> {
  const parsed = await saveConfigFileAtomic(config);

  // Clear shell detection caches when preferredShell changes so next command picks up the new setting
  if (cachedConfig?.preferredShell !== parsed.preferredShell) {
    clearWindowsShellCache();
    clearWslCache();
  }

  cachedConfig = parsed;
  cachedConfigFingerprint = await configFileFingerprint();
}

/** Validate, back up, and atomically replace a config file without hiding corruption. */
export async function saveConfigFileAtomic(
  config: Config,
  targetPath: string = configPath
): Promise<Config> {
  let parsed: Config;
  try {
    parsed = applyDefaults(config);
  } catch (error) {
    throw invalidConfigError(error, targetPath);
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  try {
    const current = await fs.readFile(targetPath, "utf-8");
    try {
      applyDefaults(JSON.parse(current) as Partial<Config>);
    } catch (error) {
      throw invalidConfigError(error, targetPath);
    }
    await writeFileAtomic(`${targetPath}.bak`, current, { mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  await writeFileAtomic(targetPath, JSON.stringify(parsed, null, 2), { mode: 0o600 });
  return parsed;
}
