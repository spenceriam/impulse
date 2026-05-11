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
});

// Provider configuration per key
const ProvidersConfigSchema = z.object({
  /** Z.ai Coding Plan */
  "z.ai": ProviderKeySchema.optional(),
  /** OpenAI models (GPT-4, GPT-4o, etc.) */
  openai: ProviderKeySchema.optional(),
  /** Anthropic models (Claude 3.5, etc.) */
  anthropic: ProviderKeySchema.optional(),
  /** OpenRouter — aggregates 100+ models behind OpenAI-compatible API */
  openrouter: ProviderKeySchema.optional(),
  /** Groq — fast inference (Llama, Mistral, etc.) */
  groq: ProviderKeySchema.optional(),
  /** Google Gemini */
  gemini: ProviderKeySchema.optional(),
  /** Nous Research */
  nous: ProviderKeySchema.optional(),
  /** Ollama Cloud (https://ollama.com) */
  ollama: ProviderKeySchema.optional(),
});

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

  /** Default mode: WORK, EXPLORE, PLAN, DEBUG */
  defaultMode: z.string().default("WORK").describe("Default agent mode"),

  /** Reasoning/thinking level for AI responses.
   * "off" = disabled; "low"/"medium"/"high" = enabled at that depth.
   * Binary providers (Ollama, ZAI) treat any non-"off" as enabled. */
  reasoningLevel: ReasoningLevelSchema.default("medium"),

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
  cachedConfig = applyDefaults(merged);
  return cachedConfig;
}

export async function save(config: Config): Promise<void> {
  await fs.mkdir(Global.Path.config, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  cachedConfig = config;
}
