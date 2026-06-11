import {
  discoverOllamaReasoning,
  getLevelsForStyle,
  PROVIDER_REASONING_STYLE,
  probeReasoningSupport,
  type ReasoningCapability,
} from "../api/providers/capabilities.js";
import { parseModelString } from "../api/manager.js";
import type { Config, ReasoningLevel } from "../util/config.js";

export function reasoningLevelFromConfig(config: Config): ReasoningLevel {
  return config.reasoningLevel ?? (config.thinking ? "medium" : "off");
}

/** Whether sub-agents should publish thinking... progress lines for this run. */
export function isSubagentThinkingEnabled(
  config: Config,
  capability: ReasoningCapability
): boolean {
  if (reasoningLevelFromConfig(config) === "off") return false;
  return capability.supported;
}

async function reasoningCapabilityForModel(
  config: Config,
  model: string
): Promise<ReasoningCapability> {
  const { provider, model: modelName } = parseModelString(
    model,
    config.defaultProvider
  );

  if (provider === "ollama") {
    const baseUrl =
      (config.providers as Record<string, { baseUrl?: string }>)?.["ollama"]?.baseUrl ??
      "https://ollama.com";
    const apiKey = (config.providers as Record<string, { apiKey?: string }>)?.["ollama"]
      ?.apiKey;
    return discoverOllamaReasoning(baseUrl, modelName, apiKey);
  }

  let style = PROVIDER_REASONING_STYLE[provider];
  if (!style) {
    const providerType = (config.providers as Record<string, { type?: string }>)[provider]
      ?.type;
    style = providerType === "anthropic-compatible" ? "budget" : "effort";
    const pc = (config.providers as Record<string, { type?: string; baseUrl?: string; apiKey?: string }>)[
      provider
    ];
    if (
      (pc?.type === "openai-compatible" || pc?.type === "anthropic-compatible") &&
      pc.baseUrl &&
      pc.apiKey &&
      modelName
    ) {
      try {
        return await probeReasoningSupport(pc.type, pc.baseUrl, pc.apiKey, modelName);
      } catch {
        // fall through to style-based default
      }
    }
  }

  return {
    supported: style !== "none",
    style,
    levels: getLevelsForStyle(style),
  };
}

/** Resolve once per agent run (model + config). */
export async function resolveSubagentThinkingEnabled(
  config: Config,
  model: string
): Promise<boolean> {
  const capability = await reasoningCapabilityForModel(config, model);
  return isSubagentThinkingEnabled(config, capability);
}
