import fs from "fs/promises";
import path from "path";
import { testOllamaConnection } from "../api/providers/ollama.js";
import type { Editor } from "@mariozechner/pi-tui";
import { fuzzyFilter } from "@mariozechner/pi-tui";
import type { Config } from "../util/config.js";

export interface ModelProviderOption {
  key: string;
  label: string;
  envVar: string;
  defaultModel: string;
  modelBaseUrl: string;
  defaultBaseUrl?: string;
  needsBaseUrl?: boolean;
  isCustom?: boolean;
  customType?: "openai-compatible" | "anthropic-compatible";
}

export interface StoredProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  type?: "openai-compatible" | "anthropic-compatible";
}

export interface ModelDiscoveryResult {
  success: boolean;
  message: string;
  models: string[];
}

export const KNOWN_PROVIDER_KEYS = new Set([
  "ollama", "openrouter", "openai", "z.ai", "anthropic", "groq", "gemini", "nous",
]);

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
    key: "__custom_openai__",
    label: "Custom Provider (OpenAI-compatible)",
    envVar: "",
    defaultModel: "",
    modelBaseUrl: "",
    needsBaseUrl: true,
    isCustom: true,
    customType: "openai-compatible",
  },
  {
    key: "__custom_anthropic__",
    label: "Custom Provider (Anthropic-compatible)",
    envVar: "",
    defaultModel: "",
    modelBaseUrl: "https://api.anthropic.com/v1",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    needsBaseUrl: true,
    isCustom: true,
    customType: "anthropic-compatible",
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

/** Mask API key showing first 4 + asterisks + last 4 (full length) */
export function maskKeyFull(key: string | undefined): string {
  if (!key) return "not configured";
  if (key.length <= 8) return "*".repeat(key.length);
  const prefix = key.slice(0, 4);
  const suffix = key.slice(-4);
  const middle = "*".repeat(key.length - 8);
  return `${prefix}${middle}${suffix}`;
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
    const sorted = await sortModels(provider.key, result.models);
    return { success: result.success, message: result.message, models: sorted };
  }

  const root = (baseUrl ?? provider.modelBaseUrl).replace(/\/$/, "");

  // Anthropic-compatible uses x-api-key header instead of Bearer
  const isAnthropic = provider.customType === "anthropic-compatible";
  const headers: Record<string, string> = { "Accept": "application/json" };
  if (apiKey) {
    if (isAnthropic) {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
  }

  // For custom providers, try both auth methods (some endpoints expect Bearer even for Anthropic)
  const isCustomProv = provider.isCustom || provider.key.startsWith("__");
  const authMethods: Array<{ name: string; headers: Record<string, string> }> = [];

  if (isAnthropic) {
    // Primary: Anthropic auth
    const h1: Record<string, string> = { "Accept": "application/json" };
    if (apiKey) { h1["x-api-key"] = apiKey; h1["anthropic-version"] = "2023-06-01"; }
    authMethods.push({ name: "x-api-key", headers: h1 });
    // Fallback: Bearer auth (for endpoints that serve /models with OpenAI auth)
    if (isCustomProv && apiKey) {
      const h2: Record<string, string> = { "Accept": "application/json" };
      h2["Authorization"] = `Bearer ${apiKey}`;
      authMethods.push({ name: "Bearer (fallback)", headers: h2 });
    }
  } else {
    // Primary: Bearer auth
    const h1: Record<string, string> = { "Accept": "application/json" };
    if (apiKey) h1["Authorization"] = `Bearer ${apiKey}`;
    authMethods.push({ name: "Bearer", headers: h1 });
    // Fallback: Anthropic auth (for custom providers)
    if (isCustomProv && apiKey) {
      const h2: Record<string, string> = { "Accept": "application/json" };
      h2["x-api-key"] = apiKey;
      h2["anthropic-version"] = "2023-06-01";
      authMethods.push({ name: "x-api-key (fallback)", headers: h2 });
    }
  }

  let lastError: ModelDiscoveryResult | null = null;

  for (const method of authMethods) {
    try {
      const url = `${root}/models`;
        const res = await fetch(url, {
          headers: method.headers,
          signal: AbortSignal.timeout(10_000),
        });

        if (res.status === 401 || res.status === 403) {
          lastError = {
            success: false,
            message: `Authentication failed (HTTP ${res.status}). Check the ${provider.label} API key.`,
            models: [],
          };
          continue; // Try next auth method or path
        }

        if (res.status === 404) {
          lastError = {
            success: false,
            message: `Model discovery not supported (HTTP 404).`,
            models: [],
          };
          continue; // Try next auth method or path
        }

        if (!res.ok) {
          lastError = {
            success: false,
            message: `Model discovery failed (HTTP ${res.status}).`,
            models: [],
          };
          continue;
        }

        const body = await res.json() as {
          data?: Array<{ id?: string; name?: string; created?: number; created_at?: string }>;
          models?: Array<{ id?: string; name?: string; created?: number; created_at?: string }>;
        };
        const entries = body.data ?? body.models ?? [];

        if (entries.length > 1 && entries.some((e) => e.created !== undefined || e.created_at !== undefined)) {
          const sorted = entries
            .slice()
            .sort((a, b) => {
              const aCreated = a.created ?? (a.created_at ? new Date(a.created_at).getTime() / 1000 : 0);
              const bCreated = b.created ?? (b.created_at ? new Date(b.created_at).getTime() / 1000 : 0);
              return (bCreated as number) - (aCreated as number);
            })
            .map((m) => m.id ?? m.name)
            .filter((m): m is string => typeof m === "string" && m.length > 0);

          const sorted2 = await sortModels(provider.key, sorted);
          return {
            success: true,
            message: sorted2.length > 0
              ? `Connected - ${sorted2.length} model${sorted2.length === 1 ? "" : "s"} available.`
              : "Connected, but no models were returned.",
            models: sorted2,
          };
        }

        const models = entries
          .map((m) => m.id ?? m.name)
          .filter((m): m is string => typeof m === "string" && m.length > 0);

        const sorted2 = await sortModels(provider.key, models);

        return {
          success: true,
          message: sorted2.length > 0
            ? `Connected - ${sorted2.length} model${sorted2.length === 1 ? "" : "s"} available.`
            : "Connected, but no models were returned.",
          models: sorted2,
        };
      } catch (error) {
        lastError = {
          success: false,
          message: error instanceof Error && error.name === "TimeoutError"
            ? "Model discovery timed out."
            : error instanceof Error
              ? error.message
              : String(error),
          models: [],
        };
        // Continue to next auth method
      }
    }

  return lastError ?? { success: false, message: "Model discovery failed.", models: [] };
}

/**
 * Sort models by creation date (newest first) using models.dev API.
 * Falls back to size-based sorting if API unavailable.
 */
async function sortModels(providerKey: string, models: string[]): Promise<string[]> {
  if (models.length <= 1) return models;

  // Skip models.dev lookup for custom/sentinel keys
  if (providerKey.startsWith("__")) {
    return [...models].sort((a, b) => {
      const sizeA = extractModelSize(a);
      const sizeB = extractModelSize(b);
      return sizeB - sizeA;
    });
  }

  try {
    // Fetch model metadata from models.dev
    const res = await fetch(`https://models.dev/api/v1/providers/${providerKey}/models`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (res.ok) {
      const body = await res.json() as {
        models?: Array<{ id?: string; created?: string | number }>;
      };
      const metadata = new Map<string, Date>();
      for (const m of body.models ?? []) {
        if (m.id && m.created) {
          metadata.set(m.id, new Date(m.created));
        }
      }

      // Sort by creation date (newest first)
      if (metadata.size > 0) {
        return [...models].sort((a, b) => {
          const dateA = metadata.get(a);
          const dateB = metadata.get(b);
          if (dateA && dateB) return dateB.getTime() - dateA.getTime();
          if (dateA) return -1;
          if (dateB) return 1;
          return 0;
        });
      }
    }
  } catch {
    // Fall through to size-based sorting
  }

  // Fallback: sort by size (largest first, parsed from model name)
  return [...models].sort((a, b) => {
    const sizeA = extractModelSize(a);
    const sizeB = extractModelSize(b);
    return sizeB - sizeA;
  });
}

/** Extract model size from name (e.g., "70b" -> 70, "13b" -> 13) */
function extractModelSize(name: string): number {
  const match = name.match(/(\d+\.?\d*)\s*b/i);
  return match ? parseFloat(match[1]!) : 0;
}

/** Validate a custom provider name — must be a clean slug */
export function validateProviderName(name: string): string | null {
  if (!name || name.length === 0) return "Name is required.";
  if (name.length > 30) return "Name must be 30 characters or fewer.";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) return "Name must start with a letter or number and contain only letters, numbers, hyphens, and underscores.";
  if (name.startsWith("__")) return "Name cannot start with '__' (reserved).";
  if (KNOWN_PROVIDER_KEYS.has(name.toLowerCase())) return `'${name}' conflicts with a built-in provider. Choose a different name.`;
  return null;
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

  if (provider.envVar) values.set(provider.envVar, apiKey);
  if (provider.key === "ollama" && baseUrl) values.set("OLLAMA_BASE_URL", baseUrl);

  const lines = [...values.entries()].map(([key, value]) => `${key}=${value}`);
  await fs.writeFile(envPath, `${lines.join("\n")}\n`, { mode: 0o600 });
}

/** Wire up fuzzy model autocomplete on the pi-tui Editor during model selection */
export function setModelAutocomplete(editor: Editor, models: string[]): void {
  editor.setAutocompleteProvider({
    async getSuggestions(lines, cursorLine, cursorCol, _opts) {
      const line = lines[cursorLine] ?? "";
      const prefix = line.slice(0, cursorCol);

      if (prefix.length === 0) {
        // Show first 30 models when input is empty
        return {
          items: models.slice(0, 30).map((m) => ({ value: m, label: m })),
          prefix: "",
        };
      }

      const filtered = fuzzyFilter(models, prefix, (m) => m).slice(0, 30);
      if (filtered.length === 0) return null;

      return {
        items: filtered.map((m) => ({ value: m, label: m })),
        prefix,
      };
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      const line = lines[cursorLine] ?? "";
      const before = line.slice(0, cursorCol - prefix.length);
      const after = line.slice(cursorCol);
      const newLine = before + item.value + after;
      return {
        lines: lines.map((l, i) => (i === cursorLine ? newLine : l)),
        cursorLine,
        cursorCol: before.length + item.value.length,
      };
    },
  });
}
