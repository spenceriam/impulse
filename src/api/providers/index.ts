/**
 * Providers barrel
 *
 * Re-exports all provider types (from the base provider module) and all
 * concrete provider implementations so callers can import from one place.
 */

// ── Base types ──────────────────────────────────────────────────────────────
export type {
  AIProvider,
  ProviderConfig,
  CompletionOptions,
  StreamCompletionOptions,
} from "../provider";
export { ProviderError, ProviderAuthError, ProviderRateLimitError } from "../provider";

// ── Concrete providers ───────────────────────────────────────────────────────
export { ZAIProvider } from "./zai";
export { OpenAIProvider } from "./openai";
export { NousProvider, NOUS_DEFAULT_MODEL } from "./nous";
export { OpenRouterProvider } from "./openrouter";
export { GroqProvider, GROQ_MODELS } from "./groq";
export { GeminiProvider } from "./gemini";
export {
  OllamaProvider,
  OLLAMA_DEFAULT_BASE_URL,
  ollamaSupportsReasoning,
  testOllamaConnection,
  type OllamaConnectionTestResult,
} from "./ollama";
export {
  discoverOllamaReasoning,
  cycleReasoningLevel,
  getLevelsForStyle,
  PROVIDER_REASONING_STYLE,
  EFFORT_LEVELS,
  BINARY_LEVELS,
  NO_LEVELS,
  type ReasoningCapability,
  type ReasoningStyle,
} from "./capabilities";
