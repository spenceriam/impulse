import fs from "fs/promises";
import path from "path";
import { testOllamaConnection } from "../api/providers/ollama.js";
import type { Editor } from "@mariozechner/pi-tui";
import { fuzzyFilter } from "@mariozechner/pi-tui";
import type { Config } from "../util/config.js";
import {
  advertisedReasoningLevels,
  EFFORT_LEVELS,
  mergeReasoningLevels,
  setReasoningLevelsForModel,
} from "../api/providers/capabilities.js";
import { modelSupportsVisionCached, setModelCapabilities } from "../api/capabilities.js";
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
  "z.ai-api", "z.ai-anthropic", "kimi", "kimi-api", "kimi-anthropic",
  "kimi-cn", "minimax", "minimax-anthropic", "minimax-cn", "deepseek", "deepseek-anthropic",
]);

export const MODEL_PROVIDERS: ModelProviderOption[] = [
  {
    // First-class: the endpoint is fixed. A custom or self-hosted Ollama is the
    // custom-provider path, so setup asks for the API key only (#211).
    key: "ollama",
    label: "Ollama Cloud",
    envVar: "OLLAMA_API_KEY",
    defaultModel: "",
    modelBaseUrl: "https://ollama.com",
    defaultBaseUrl: "https://ollama.com",
  },
  {
    key: "openrouter",
    label: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    defaultModel: "openrouter/anthropic/claude-haiku-4.5",
    modelBaseUrl: "https://openrouter.ai/api/v1",
  },
  // Subscription/plan and pay-as-you-go endpoints differ per provider and keys
  // are not interchangeable between them (docs, 2026-11-21) — each is its own
  // entry so the user picks the one matching their key (#211).
  {
    key: "z.ai",
    label: "Z.ai (Coding Plan)",
    envVar: "ZAI_API_KEY",
    defaultModel: "z.ai/glm-5.3",
    modelBaseUrl: "https://api.z.ai/api/coding/paas/v4",
  },
  {
    key: "z.ai-api",
    label: "Z.ai (API / balance)",
    envVar: "ZAI_API_KEY",
    defaultModel: "z.ai/glm-5.2",
    modelBaseUrl: "https://api.z.ai/api/paas/v4",
  },
  {
    key: "kimi",
    label: "Kimi (Coding Plan)",
    envVar: "KIMI_API_KEY",
    defaultModel: "",
    modelBaseUrl: "https://api.kimi.com/coding/v1",
    defaultBaseUrl: "https://api.kimi.com/coding/v1",
  },
  {
    key: "kimi-api",
    label: "Kimi (Moonshot API)",
    envVar: "MOONSHOT_API_KEY",
    defaultModel: "",
    modelBaseUrl: "https://api.moonshot.ai/v1",
    defaultBaseUrl: "https://api.moonshot.ai/v1",
  },
  {
    // One entry: Token Plan and pay-as-you-go share the endpoint, and the key
    // decides the billing (sk-cp-… = subscription).
    key: "minimax",
    label: "MiniMax (Token Plan or API key)",
    envVar: "MINIMAX_API_KEY",
    defaultModel: "",
    modelBaseUrl: "https://api.minimax.io/v1",
    defaultBaseUrl: "https://api.minimax.io/v1",
  },
  {
    key: "deepseek",
    label: "DeepSeek",
    envVar: "DEEPSEEK_API_KEY",
    defaultModel: "",
    modelBaseUrl: "https://api.deepseek.com",
    defaultBaseUrl: "https://api.deepseek.com",
  },
  // Anthropic-protocol endpoints for the same plans (docs, 2026-11-21):
  // some tools speak Anthropic Messages and the provider serves both.
  {
    key: "z.ai-anthropic",
    label: "Z.ai (Coding Plan, Anthropic)",
    envVar: "ZAI_API_KEY",
    defaultModel: "z.ai/glm-5.3",
    modelBaseUrl: "https://api.z.ai/api/anthropic",
    customType: "anthropic-compatible",
  },
  {
    key: "kimi-anthropic",
    label: "Kimi (Coding Plan, Anthropic)",
    envVar: "KIMI_API_KEY",
    defaultModel: "",
    modelBaseUrl: "https://api.kimi.com/coding/",
    customType: "anthropic-compatible",
  },
  {
    key: "minimax-anthropic",
    label: "MiniMax (Token Plan or API key, Anthropic)",
    envVar: "MINIMAX_API_KEY",
    defaultModel: "",
    modelBaseUrl: "https://api.minimax.io/anthropic",
    customType: "anthropic-compatible",
  },
  {
    key: "deepseek-anthropic",
    label: "DeepSeek (Anthropic)",
    envVar: "DEEPSEEK_API_KEY",
    defaultModel: "",
    modelBaseUrl: "https://api.deepseek.com/anthropic",
    customType: "anthropic-compatible",
  },
  {
    key: "kimi-cn",
    label: "Kimi (Moonshot China)",
    envVar: "MOONSHOT_API_KEY",
    defaultModel: "",
    modelBaseUrl: "https://api.moonshot.cn/v1",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
  },
  {
    key: "minimax-cn",
    label: "MiniMax (China)",
    envVar: "MINIMAX_API_KEY",
    defaultModel: "",
    modelBaseUrl: "https://api.minimaxi.com/v1",
    defaultBaseUrl: "https://api.minimaxi.com/v1",
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

/** Whether stored config is sufficient to use a built-in provider. */
export function isStoredProviderConfigured(
  providerKey: string,
  stored: StoredProviderConfig
): boolean {
  if (providerKey === "ollama") {
    return !!(stored.apiKey || stored.baseUrl);
  }
  return !!stored.apiKey;
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

async function enrichDiscoveredModelsOrFallback(
  catalogKey: string,
  modelIds: string[],
  apiEntries?: ProviderModelEntry[]
): Promise<ModelInfo[]> {
  try {
    return await enrichDiscoveredModels(catalogKey, modelIds, apiEntries);
  } catch {
    return fallbackModelInfosFromIds(modelIds);
  }
}

async function discoverModelsOnce(
  provider: ModelProviderOption,
  apiKey: string,
  baseUrl: string | undefined
): Promise<ModelDiscoveryResult> {
  const catalogKey = provider.key;

  if (provider.key === "ollama") {
    const result = await testOllamaConnection(
      baseUrl ?? provider.defaultBaseUrl ?? provider.modelBaseUrl,
      apiKey
    );
    if (!result.success || result.models.length === 0) {
      return { success: result.success, message: result.message, models: [] };
    }
    const infos = await enrichDiscoveredModelsOrFallback(catalogKey, result.models);
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
            ...(m.context_length !== undefined ? { context_length: m.context_length } : {}),
            ...(m.created !== undefined ? { created: m.created } : {}),
            ...(m.created_at !== undefined ? { created_at: m.created_at } : {}),
          }))
          .filter((m) => m.id.length > 0);

        // Provider-advertised per-model metadata (#147 / #210 / #211), read
        // generically so a new provider needs no new branch: reasoning tiers
        // (OpenRouter `reasoning_efforts`/`supported_parameters`, DeepSeek
        // `effort.supported_levels`), context window, output cap, and input
        // modalities. Providers that publish nothing simply yield nothing.
        for (const entry of entries as Array<Record<string, unknown>>) {
          const id = (entry["id"] ?? entry["name"] ?? "") as string;
          if (!id) continue;

          const effort = entry["effort"] as { supported_levels?: unknown } | undefined;
          const extra = advertisedReasoningLevels(
            entry["reasoning_efforts"] ??
              entry["supported_parameters"] ??
              effort?.supported_levels
          );
          if (extra.length > 0) {
            setReasoningLevelsForModel(id, mergeReasoningLevels(EFFORT_LEVELS, extra));
          }

          const modalities = entry["input_modalities"];
          const context = entry["context_window"] ?? entry["context_length"];
          const maxOut = entry["max_output_tokens"];
          const hasCapabilityData =
            Array.isArray(modalities) ||
            typeof context === "number" ||
            typeof maxOut === "number" ||
            extra.length > 0;
          if (hasCapabilityData) {
            setModelCapabilities(id, {
              vision: Array.isArray(modalities)
                ? modalities.includes("image")
                : modelSupportsVisionCached(id),
              reasoning: extra.length > 0,
              ...(typeof context === "number" ? { contextLength: context } : {}),
              ...(typeof maxOut === "number" ? { maxOutputTokens: maxOut } : {}),
              source: "provider-api",
            });
          }
        }

        const ids = apiRows.map((m) => m.id);
        if (ids.length === 0) {
          lastError = {
            success: true,
            message: "Connected, but no models were returned.",
            models: [],
          };
          continue;
        }

        const infos = await enrichDiscoveredModelsOrFallback(catalogKey, ids, apiRows);
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

/** Remove provider API key (and related vars) from ~/.impulse/.env */
export async function removeProviderFromHomeEnv(
  provider: ModelProviderOption
): Promise<void> {
  const homeDir = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
  if (!homeDir) return;

  const envPath = path.join(homeDir, ".impulse", ".env");
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
    return;
  }

  // Shared env vars: z.ai / z.ai-anthropic both use ZAI_API_KEY, so removing one
  // provider must not strip the key another still uses (#214 edge cases A3/B4).
  if (provider.envVar) {
    const stillUsed = MODEL_PROVIDERS.some(
      (p) => p.key !== provider.key && p.envVar === provider.envVar
    );
    if (!stillUsed) values.delete(provider.envVar);
  }
  if (provider.key === "ollama") values.delete("OLLAMA_BASE_URL");

  const lines = [...values.entries()].map(([key, value]) => `${key}=${value}`);
  if (lines.length === 0) {
    try {
      await fs.unlink(envPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return;
  }
  await fs.writeFile(envPath, `${lines.join("\n")}\n`, { mode: 0o600 });
}

export function modelUsesProvider(model: string | undefined, providerKey: string): boolean {
  if (!model?.trim()) return false;
  const prefix = `${providerKey}/`;
  return model === providerKey || model.startsWith(prefix);
}

const BUILTIN_PROVIDER_LABELS: Record<string, string> = {
  "z.ai": "Z.ai",
  openai: "OpenAI",
  anthropic: "Anthropic",
  groq: "Groq",
  gemini: "Google Gemini",
  nous: "Nous Research",
};

export function builtinProviderLabel(key: string): string {
  return (
    MODEL_PROVIDERS.find((p) => p.key === key)?.label ??
    BUILTIN_PROVIDER_LABELS[key] ??
    key
  );
}

/** Configured providers for /model picker (custom + env/file builtins). */
export function listConfiguredProviderKeysForPicker(
  config: Config
): Array<{ providerKey: string; provider: ModelProviderOption }> {
  const entries: Array<{ providerKey: string; provider: ModelProviderOption }> = [];
  const seen = new Set<string>();

  for (const key of listConfiguredCustomProviderKeys(config)) {
    const stored = providerConfig(config, key);
    if (!isStoredProviderConfigured(key, stored)) continue;
    seen.add(key);
    entries.push({ providerKey: key, provider: resolveCustomProviderOption(key, config) });
  }

  for (const key of KNOWN_PROVIDER_KEYS) {
    if (seen.has(key)) continue;
    const stored = providerConfig(config, key);
    if (!isStoredProviderConfigured(key, stored)) continue;
    const template = MODEL_PROVIDERS.find((p) => !p.isCustom && p.key === key);
    entries.push({
      providerKey: key,
      provider:
        template ??
        ({
          key,
          label: builtinProviderLabel(key),
          envVar: "",
          defaultModel: "",
          modelBaseUrl: "",
        } satisfies ModelProviderOption),
    });
  }

  return entries;
}

export function countConfiguredProviders(config: Config): number {
  let n = 0;
  for (const key of listConfiguredCustomProviderKeys(config)) {
    if (isStoredProviderConfigured(key, providerConfig(config, key))) n++;
  }
  for (const mp of MODEL_PROVIDERS) {
    if (mp.isCustom) continue;
    if (isStoredProviderConfigured(mp.key, providerConfig(config, mp.key))) n++;
  }
  return n;
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
