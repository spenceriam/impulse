import fs from "fs/promises";
import path from "path";
import { testOllamaConnection } from "../api/providers/ollama.js";
import type { Editor } from "@mariozechner/pi-tui";
import { fuzzyFilter } from "@mariozechner/pi-tui";
import type { Config } from "../util/config.js";
import {
  enrichDiscoveredModels,
  fallbackModelInfosFromIds,
  type ModelInfo,
  type ProviderModelEntry,
} from "./model-catalog.js";

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

/** Configured custom provider keys (excludes built-in provider keys). */
export function listConfiguredCustomProviderKeys(config: Config): string[] {
  const providers = (config.providers as Record<string, StoredProviderConfig | undefined>) ?? {};
  return Object.keys(providers).filter(
    (k) => !MODEL_PROVIDERS.some((p) => !p.isCustom && p.key === k)
  );
}

/** One template per custom provider from stored `type` (avoids duplicate picker rows). */
export function resolveCustomProviderOption(
  providerKey: string,
  config: Config
): ModelProviderOption {
  const stored = providerConfig(config, providerKey);
  const customType = stored.type ?? "openai-compatible";
  const template =
    MODEL_PROVIDERS.find((p) => p.isCustom && p.customType === customType) ??
    MODEL_PROVIDERS.find((p) => p.key === "__custom_openai__")!;
  return { ...template, key: providerKey, label: providerKey };
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

const DISCOVERY_RETRIES = 3;
const DISCOVERY_BACKOFF_MS = [0, 250, 500];

export async function discoverModels(
  provider: ModelProviderOption,
  apiKey: string,
  baseUrl: string | undefined
): Promise<ModelDiscoveryResult> {
  let last: ModelDiscoveryResult = {
    success: false,
    message: "Model discovery failed.",
    models: [],
  };

  for (let attempt = 0; attempt < DISCOVERY_RETRIES; attempt++) {
    if (DISCOVERY_BACKOFF_MS[attempt]! > 0) {
      await Bun.sleep(DISCOVERY_BACKOFF_MS[attempt]!);
    }
    last = await discoverModelsOnce(provider, apiKey, baseUrl);
    if (last.success && last.models.length > 0) {
      return last;
    }
  }

  return last;
}

async function discoverModelsOnce(
  provider: ModelProviderOption,
  apiKey: string,
  baseUrl: string | undefined
): Promise<ModelDiscoveryResult> {
  const catalogKey = provider.isCustom || provider.key.startsWith("__")
    ? provider.key
    : provider.key;

  if (provider.key === "ollama") {
    const result = await testOllamaConnection(
      baseUrl ?? provider.defaultBaseUrl ?? provider.modelBaseUrl,
      apiKey
    );
    if (!result.success || result.models.length === 0) {
      return { success: result.success, message: result.message, models: [] };
    }
    const infos = await enrichDiscoveredModels(catalogKey, result.models);
    if (infos.length > 0) setCachedModelInfos(provider.key, infos);
    return {
      success: true,
      message: `Connected - ${infos.length} model${infos.length === 1 ? "" : "s"} available.`,
      models: infos.map((i) => i.id),
    };
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
          data?: Array<{
            id?: string;
            name?: string;
            created?: number;
            created_at?: string;
            context_length?: number;
          }>;
          models?: Array<{
            id?: string;
            name?: string;
            created?: number;
            created_at?: string;
            context_length?: number;
          }>;
        };
        const entries = body.data ?? body.models ?? [];

        const apiRows: ProviderModelEntry[] = entries
          .map((m) => ({
            id: (m.id ?? m.name ?? "") as string,
            context_length: m.context_length,
            created: m.created,
            created_at: m.created_at,
          }))
          .filter((m) => m.id.length > 0);

        const ids = apiRows.map((m) => m.id);
        if (ids.length === 0) {
          lastError = {
            success: true,
            message: "Connected, but no models were returned.",
            models: [],
          };
          continue;
        }

        let infos: ModelInfo[];
        try {
          infos = await enrichDiscoveredModels(catalogKey, ids, apiRows);
        } catch {
          infos = fallbackModelInfosFromIds(ids);
        }
        if (infos.length > 0) setCachedModelInfos(provider.key, infos);

        return {
          success: true,
          message: `Connected - ${infos.length} model${infos.length === 1 ? "" : "s"} available.`,
          models: infos.map((i) => i.id),
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

// ── Model list cache ────────────────────────────────────────────────────────

const modelCache = new Map<string, { infos: ModelInfo[]; fetchedAt: number }>();
const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/** Get cached enriched models for a provider, if fresh enough */
export function getCachedModelInfos(providerKey: string): ModelInfo[] | undefined {
  const entry = modelCache.get(providerKey);
  if (!entry) return undefined;
  if (Date.now() - entry.fetchedAt > MODEL_CACHE_TTL) {
    modelCache.delete(providerKey);
    return undefined;
  }
  if (entry.infos.length === 0) return undefined;
  return entry.infos;
}

/** @deprecated Use getCachedModelInfos */
export function getCachedModels(providerKey: string): string[] | undefined {
  const infos = getCachedModelInfos(providerKey);
  return infos?.map((i) => i.id);
}

export function setCachedModelInfos(providerKey: string, infos: ModelInfo[]): void {
  if (infos.length === 0) return;
  modelCache.set(providerKey, { infos, fetchedAt: Date.now() });
}

/** @deprecated Use setCachedModelInfos */
export function setCachedModels(providerKey: string, models: string[]): void {
  if (models.length === 0) return;
  modelCache.set(providerKey, {
    infos: models.map((id) => ({
      id,
      vendor: "—",
      displayName: id,
      pickerLine: id,
    })),
    fetchedAt: Date.now(),
  });
}

/** Clear model cache for all or specific provider */
export function clearModelCache(providerKey?: string): void {
  if (providerKey) {
    modelCache.delete(providerKey);
  } else {
    modelCache.clear();
  }
}
