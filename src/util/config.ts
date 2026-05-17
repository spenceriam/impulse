import { Global } from "../global";
import fs from "fs/promises";
import path from "path";
import z from "zod";

// ============================================================
// Multi-Provider Config Schema
// ============================================================

// Reasoning/thinking level — unified across all providers
// "off" = disabled; "low"/"medium"/"high" = enabled at that depth
// Binary providers (Ollama, ZAI) treat any non-"off" value as on
export type ReasoningLevel = "off" | "low" | "medium" | "high";
const ReasoningLevelSchema = z.enum(["off", "low", "medium", "high"]);

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

  /** Default model — include provider prefix when ambiguous (e.g. "openai/gpt-4o") */
  defaultModel: z.string().default("ollama/llama3.2").describe("Default model to use"),

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
    responsePreference: z.string().default("concise"),
    /** Custom instructions injected into every system prompt */
    customInstructions: z.string().default(""),
  }).optional(),

  // Legacy — kept for smooth migration; prefer providers[].apiKey
  apiKey: z.string().optional().describe("Legacy: use providers[defaultProvider].apiKey instead"),
});

export type Config = z.infer<typeof ConfigSchema>;
export type UserProfile = NonNullable<Config["userProfile"]>;

const configPath = path.join(Global.Path.config, "config.json");

async function loadConfigFile(): Promise<Partial<Config>> {
  try {
    const content = await fs.readFile(configPath, "utf-8");
    return JSON.parse(content);
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

let cachedConfig: Config | null = null;

export async function load(): Promise<Config> {
  if (cachedConfig !== null) {
    return cachedConfig;
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
  cachedConfig = applyDefaults(merged as Partial<Config>);
  return cachedConfig;
}

export async function save(config: Config): Promise<void> {
  await fs.mkdir(Global.Path.config, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  cachedConfig = config;
}
