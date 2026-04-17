/**
 * Provider Manager
 *
 * Routes model strings to the correct AIProvider implementation.
 * Model string format: "provider/model"  (e.g. "openai/gpt-4o", "anthropic/claude-3-5-sonnet")
 * If no prefix, uses the configured defaultProvider.
 *
 * Usage:
 *   const manager = await ProviderManager.create();
 *   const provider = manager.getProvider("openai/gpt-4o");
 *   for await (const chunk of provider.stream({ messages, model: "openai/gpt-4o" })) { ... }
 */

import { load as loadConfig } from "../util/config";
import type { Config } from "../util/config";
import type {
  AIProvider,
  CompletionOptions,
  StreamCompletionOptions,
  ProviderConfig,
} from "./provider";
import { ProviderError } from "./provider";
import { ZAIProvider } from "./providers/zai";
import { OpenAIProvider } from "./providers/openai";
import { NousProvider } from "./providers/nous";
import { OpenRouterProvider } from "./providers/openrouter";
import { GroqProvider } from "./providers/groq";
import { GeminiProvider } from "./providers/gemini";

// Re-export all providers
export { ZAIProvider } from "./providers/zai";
export { OpenAIProvider } from "./providers/openai";
export { NousProvider } from "./providers/nous";
export { OpenRouterProvider } from "./providers/openrouter";
export { GroqProvider } from "./providers/groq";
export { GeminiProvider } from "./providers/gemini";

// Well-known provider prefixes
export const PROVIDER_PREFIXES = [
  "z.ai",
  "openai",
  "anthropic",
  "openrouter",
  "groq",
  "gemini",
  "nous",
  "minimax",
] as const;

// Aliases — maps prefix strings to their canonical provider key
export const PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map([
  ["minimax", "nous"],
  ["xiaomi", "nous"],
]);

export type ProviderKey = (typeof PROVIDER_PREFIXES)[number];

export interface ModelInfo {
  /** The full model string as passed in */
  full: string;
  /** Provider key (e.g. "openai", "anthropic") */
  provider: string;
  /** Model name without provider prefix (e.g. "gpt-4o") */
  model: string;
}

/**
 * Parse a model string into its provider and model name.
 * "openai/gpt-4o" → { provider: "openai", model: "gpt-4o" }
 * "gpt-4o"        → { provider: defaultProvider, model: "gpt-4o" }
 */
export function parseModelString(model: string, defaultProvider: string): ModelInfo {
  const parts = model.split("/");
  if (parts.length >= 2) {
    // Check known prefixes OR aliases (e.g. "minimax" → "nous", "xiaomi" → "nous")
    const prefix = parts[0]!;
    if (PROVIDER_PREFIXES.includes(prefix as ProviderKey) || PROVIDER_ALIASES.has(prefix)) {
      const resolvedProvider = PROVIDER_ALIASES.get(prefix) ?? prefix;
      return {
        full: model,
        provider: resolvedProvider,
        model: parts.slice(1).join("/"),
      };
    }
  }
  // No provider prefix — use default
  return {
    full: model,
    provider: defaultProvider,
    model: model,
  };
}

/**
 * Get the ProviderConfig for a given provider key from the app config.
 * Handles legacy top-level apiKey for smooth migration.
 */
function getProviderConfig(
  providerKey: string,
  config: Config
): ProviderConfig | null {
  const key = providerKey as keyof Config["providers"];

  // Check new per-provider config
  const providerCfg = config.providers?.[key];
  if (providerCfg?.apiKey) {
    const result: ProviderConfig = {
      apiKey: providerCfg.apiKey,
      defaultModel: config.defaultModel ?? "z.ai/glm-4.7",
    };
    if (providerCfg.baseUrl) {
      result.baseUrl = providerCfg.baseUrl;
    }
    return result;
  }

  // Fallback: legacy top-level apiKey (only for z.ai provider)
  if (providerKey === "z.ai" && config.apiKey) {
    return {
      apiKey: config.apiKey,
      defaultModel: config.defaultModel ?? "z.ai/glm-4.7",
    };
  }

  return null;
}

export class ProviderManager {
  private providers = new Map<string, AIProvider>();
  private config: Config;
  private defaultProvider: AIProvider | null = null;

  private constructor(config: Config) {
    this.config = config;
  }

  /**
   * Factory — creates a ProviderManager initialized with the current config.
   * Call this once at startup and reuse the instance.
   */
  static async create(): Promise<ProviderManager> {
    const config = await loadConfig();
    const manager = new ProviderManager(config);

    // Pre-register all available providers
    await manager.registerAvailableProviders();

    return manager;
  }

  /**
   * Register all providers that have valid credentials in the config.
   */
  private async registerAvailableProviders(): Promise<void> {
    const providerBuilders: Array<{
      key: string;
      build: (cfg: ProviderConfig) => AIProvider;
    }> = [
      { key: "z.ai", build: (cfg) => new ZAIProvider(cfg) },
      { key: "openai", build: (cfg) => new OpenAIProvider(cfg) },
      { key: "nous", build: (cfg) => new NousProvider(cfg) },
      { key: "openrouter", build: (cfg) => new OpenRouterProvider(cfg) },
      { key: "groq", build: (cfg) => new GroqProvider(cfg) },
      { key: "gemini", build: (cfg) => new GeminiProvider(cfg) },
      // Anthropic uses a custom client (not OpenAI SDK)
      // Will be added in a follow-up
    ];

    for (const { key, build } of providerBuilders) {
      const providerConfig = getProviderConfig(key, this.config);
      if (providerConfig?.apiKey) {
        const provider = build(providerConfig);
        this.providers.set(key, provider);
      }
    }

    // Set default provider
    if (this.config.defaultProvider) {
      this.defaultProvider = this.providers.get(this.config.defaultProvider) ?? null;
    }
  }

  /**
   * Get the provider instance for a model string.
   * Parses "provider/model" and returns the matching provider.
   *
   * @param model e.g. "openai/gpt-4o", "gpt-4o" (uses default), "anthropic/claude-3-5-sonnet"
   */
  getProvider(model: string): AIProvider {
    const { provider: parsedProvider } = parseModelString(model, this.config.defaultProvider);

    // Resolve aliases (e.g. "minimax" → "nous")
    const resolvedProvider = PROVIDER_ALIASES.get(parsedProvider) ?? parsedProvider;

    const aiProvider = this.providers.get(resolvedProvider);
    if (!aiProvider) {
      throw new ProviderError(
        `Provider "${resolvedProvider}" is not configured. ` +
          `Set ${resolvedProvider.toUpperCase()}_API_KEY or add it to providers.${resolvedProvider}.apiKey in config.json. ` +
          `Available providers: ${[...this.providers.keys()].join(", ") || "none"}`
      );
    }

    return aiProvider;
  }

  /**
   * Get the default provider (from config.defaultProvider).
   */
  getDefaultProvider(): AIProvider {
    if (!this.defaultProvider) {
      throw new ProviderError(
        `Default provider "${this.config.defaultProvider}" is not configured. ` +
          `Set ${this.config.defaultProvider.toUpperCase()}_API_KEY or configure providers.${this.config.defaultProvider}.apiKey.`
      );
    }
    return this.defaultProvider;
  }

  /**
   * List all configured provider names.
   */
  getAvailableProviders(): string[] {
    return [...this.providers.keys()];
  }

  /**
   * Parse a model string — utility for external callers.
   */
  parseModel(model: string): ModelInfo {
    return parseModelString(model, this.config.defaultProvider);
  }

  /**
   * Convenience: non-streaming completion.
   * Infers provider from model string.
   */
  async complete(options: CompletionOptions): Promise<ReturnType<AIProvider["complete"]>> {
    const model = options.model ?? this.config.defaultModel;
    const provider = this.getProvider(model);
    return provider.complete({ ...options, model: this.parseModel(model).model });
  }

  /**
   * Convenience: streaming completion.
   * Infers provider from model string.
   */
  stream(options: StreamCompletionOptions): AsyncGenerator<ReturnType<AIProvider["stream"]> extends AsyncGenerator<infer T, void, unknown> ? T : never, void, unknown> {
    const model = options.model ?? this.config.defaultModel;
    const provider = this.getProvider(model);
    return provider.stream({ ...options, model: this.parseModel(model).model });
  }

  /**
   * Reload config and re-register providers (call after config save).
   */
  async reload(): Promise<void> {
    this.providers.clear();
    this.config = await loadConfig();
    await this.registerAvailableProviders();
  }
}

// Singleton — initialized lazily
let _manager: ProviderManager | null = null;

export async function getProviderManager(): Promise<ProviderManager> {
  if (!_manager) {
    _manager = await ProviderManager.create();
  }
  return _manager;
}

export function resetProviderManager(): void {
  _manager = null;
}
