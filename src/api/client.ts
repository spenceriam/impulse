import { ProviderAuthError, ProviderError, ProviderRateLimitError } from "./provider";

/** @deprecated Use getProviderManager() instead. */
export const ZAIClient = {
  complete: (): never => {
    throw new ProviderError("ZAIClient is deprecated. Use getProviderManager() instead.", "deprecated");
  },
  stream: (): never => {
    throw new ProviderError("ZAIClient is deprecated. Use getProviderManager() instead.", "deprecated");
  },
};

/** @deprecated Use getProviderManager() instead. */
export const GLMClient = ZAIClient;

/** @deprecated Use ProviderError instead. */
export const ZAIClientError = ProviderError;

/** @deprecated Use ProviderError instead. */
export const GLMClientError = ProviderError;

/** @deprecated Use ProviderAuthError instead. */
export const ZAIAuthError = ProviderAuthError;

/** @deprecated Use ProviderAuthError instead. */
export const GLMAuthError = ProviderAuthError;

/** @deprecated Use ProviderRateLimitError instead. */
export const ZAIRateLimitError = ProviderRateLimitError;

/** @deprecated Use ProviderRateLimitError instead. */
export const GLMRateLimitError = ProviderRateLimitError;
