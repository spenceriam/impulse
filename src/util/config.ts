import { Global } from "../global";
import fs from "fs/promises";
import path from "path";
import z from "zod";

// ============================================================
// Multi-Provider Config Schema
// ============================================================

const ProviderKeySchema = z.object({
  /** API key for this provider */
  apiKey: z.string().optional(),
  /** Default base URL (optional — most providers have sensible defaults) */
  baseUrl: z.string().optional(),
});

// Provider configuration per key
const ProvidersConfigSchema = z.object({
  /** Z.ai / GLM models (Z.AI Coding Plan) */
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
});

export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;

const ConfigSchema = z.object({
  /** Per-provider API keys and settings */
  providers: ProvidersConfigSchema.default({}),

  /** Default provider name (e.g. "openai", "anthropic", "z.ai", "openrouter", "groq", "gemini", "nous") */
  defaultProvider: z.string().default("z.ai").describe("Which provider to use by default"),

  /** Default model — include provider prefix when ambiguous (e.g. "openai/gpt-4o") */
  defaultModel: z.string().default("z.ai/glm-4.7").describe("Default model to use"),

  /** Default mode: WORK, EXPLORE, PLAN, DEBUG */
  defaultMode: z.string().default("WORK").describe("Default agent mode"),

  /** Enable thinking mode (GLM-specific; no-op on other providers) */
  thinking: z.boolean().default(true).describe("Enable thinking mode"),

  /** Whether user has seen the welcome screen */
  hasSeenWelcome: z.boolean().default(false),

  // Legacy — kept for smooth migration; prefer providers[].apiKey
  apiKey: z.string().optional().describe("Legacy: use providers[defaultProvider].apiKey instead"),
});

export type Config = z.infer<typeof ConfigSchema>;

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
  GLM_API_KEY: "z.ai",
  OPENAI_API_KEY: "openai",
  ANTHROPIC_API_KEY: "anthropic",
  OPENROUTER_API_KEY: "openrouter",
  GROQ_API_KEY: "groq",
  GEMINI_API_KEY: "gemini",
  GOOGLE_GENERATIVE_AI_API_KEY: "gemini",
  NOUS_API_KEY: "nous",
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

  // Legacy: if GLM_API_KEY was set, also set the top-level apiKey
  if (process.env["GLM_API_KEY"]) {
    env.apiKey = process.env["GLM_API_KEY"];
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
  const merged = { ...fileConfig, ...envConfig };
  cachedConfig = applyDefaults(merged);
  return cachedConfig;
}

export async function save(config: Config): Promise<void> {
  await fs.mkdir(Global.Path.config, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  cachedConfig = config;
}
