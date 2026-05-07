import fs from "fs/promises";
import path from "path";
import { testOllamaConnection } from "../api/providers/ollama.js";
import type { Config } from "../util/config.js";

export interface ModelProviderOption {
  key: string;
  label: string;
  envVar: string;
  defaultModel: string;
  modelBaseUrl: string;
  defaultBaseUrl?: string;
  needsBaseUrl?: boolean;
}

export interface StoredProviderConfig {
  apiKey?: string;
  baseUrl?: string;
}

export interface ModelDiscoveryResult {
  success: boolean;
  message: string;
  models: string[];
}

export const MODEL_PROVIDERS: ModelProviderOption[] = [
  {
    key: "ollama",
    label: "Ollama Cloud",
    envVar: "OLLAMA_API_KEY",
    defaultModel: "ollama/llama3.2",
    modelBaseUrl: "https://ollama.com",
    defaultBaseUrl: "https://ollama.com",
    needsBaseUrl: true,
  },
  {
    key: "openrouter",
    label: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    defaultModel: "openrouter/anthropic/claude-haiku-4.5",
    modelBaseUrl: "https://openrouter.ai/api/v1",
  },
  {
    key: "openai",
    label: "OpenAI",
    envVar: "OPENAI_API_KEY",
    defaultModel: "openai/gpt-4o-mini",
    modelBaseUrl: "https://api.openai.com/v1",
  },
  {
    key: "z.ai",
    label: "Z.ai",
    envVar: "GLM_API_KEY",
    defaultModel: "z.ai/glm-4.7",
    modelBaseUrl: "https://api.z.ai/api/coding/paas/v4",
  },
  {
    key: "groq",
    label: "Groq",
    envVar: "GROQ_API_KEY",
    defaultModel: "groq/llama-3.3-70b-versatile",
    modelBaseUrl: "https://api.groq.com/openai/v1",
  },
];

export function providerConfig(config: Config, providerKey: string): StoredProviderConfig {
  const providers = config.providers as Record<string, StoredProviderConfig | undefined>;
  return providers[providerKey] ?? {};
}

export function maskKey(key: string | undefined): string {
  if (!key) return "not configured";
  if (key.length <= 8) return `${key.slice(0, 2)}...${key.slice(-2)}`;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export function modelWithProviderPrefix(providerKey: string, model: string): string {
  return model.startsWith(`${providerKey}/`) ? model : `${providerKey}/${model}`;
}

export function parseProviderChoice(
  choice: string,
  currentProvider: string
): ModelProviderOption | null {
  const trimmed = choice.trim().toLowerCase();
  if (!trimmed) {
    return MODEL_PROVIDERS.find((p) => p.key === currentProvider) ?? MODEL_PROVIDERS[0] ?? null;
  }

  const numeric = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(numeric) && MODEL_PROVIDERS[numeric - 1]) {
    return MODEL_PROVIDERS[numeric - 1]!;
  }

  return MODEL_PROVIDERS.find((p) =>
    p.key.toLowerCase() === trimmed ||
    p.label.toLowerCase() === trimmed ||
    p.label.toLowerCase().replace(/\s+/g, "") === trimmed
  ) ?? null;
}

export async function discoverModels(
  provider: ModelProviderOption,
  apiKey: string,
  baseUrl: string | undefined
): Promise<ModelDiscoveryResult> {
  if (provider.key === "ollama") {
    const result = await testOllamaConnection(
      baseUrl ?? provider.defaultBaseUrl ?? provider.modelBaseUrl,
      apiKey
    );
    return { success: result.success, message: result.message, models: result.models };
  }

  const root = (baseUrl ?? provider.modelBaseUrl).replace(/\/$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  try {
    const res = await fetch(`${root}/models`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 401 || res.status === 403) {
      return {
        success: false,
        message: `Authentication failed (HTTP ${res.status}). Check the ${provider.label} API key.`,
        models: [],
      };
    }

    if (!res.ok) {
      return {
        success: false,
        message: `Model discovery failed (HTTP ${res.status}).`,
        models: [],
      };
    }

    const body = await res.json() as {
      data?: Array<{ id?: string; name?: string }>;
      models?: Array<{ id?: string; name?: string }>;
    };
    const entries = body.data ?? body.models ?? [];
    const models = entries
      .map((m) => m.id ?? m.name)
      .filter((m): m is string => typeof m === "string" && m.length > 0);

    return {
      success: true,
      message: models.length > 0
        ? `Connected - ${models.length} model${models.length === 1 ? "" : "s"} available.`
        : "Connected, but no models were returned.",
      models,
    };
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "Model discovery timed out."
      : error instanceof Error
        ? error.message
        : String(error);
    return { success: false, message, models: [] };
  }
}

export async function saveHomeEnv(
  provider: ModelProviderOption,
  apiKey: string,
  baseUrl: string | undefined
): Promise<void> {
  const homeDir = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
  if (!homeDir) return;

  const impulseDir = path.join(homeDir, ".impulse");
  const envPath = path.join(impulseDir, ".env");
  await fs.mkdir(impulseDir, { recursive: true });

  const values = new Map<string, string>();
  try {
    const existing = await fs.readFile(envPath, "utf-8");
    for (const line of existing.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const idx = trimmed.indexOf("=");
      values.set(trimmed.slice(0, idx), trimmed.slice(idx + 1));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  values.set(provider.envVar, apiKey);
  if (provider.key === "ollama" && baseUrl) values.set("OLLAMA_BASE_URL", baseUrl);

  const lines = [...values.entries()].map(([key, value]) => `${key}=${value}`);
  await fs.writeFile(envPath, `${lines.join("\n")}\n`, { mode: 0o600 });
}
