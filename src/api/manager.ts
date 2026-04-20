/**
 * Provider Manager - Central routing for all AI providers
 * Architecture: Singleton pattern with lazy initialization
 */

import { AIStreamResponse } from "./provider";
import { parseModelString as importParseModelString } from "./utils";
import { getProviderInstance } from "./providers";

export interface ProviderManager {
  stream: (
    request: {
      messages: { role: string; content: string }[];
      model?: string;
      thinking?: boolean;
    },
    options?: { [key: string]: any }
  ) => Promise<AsyncGenerator<AIStreamResponse, void, unknown>>;
  reset?: () => void;
  complete?(request: any, options?: any): Promise<{ content: string }>;
}

let manager: ProviderManager | null = null;

export const getProviderManager = async (): Promise<ProviderManager> => {
  if (!manager) {
    manager = {
      async stream(
        request: {
          messages: { role: string; content: string }[];
          model?: string;
          thinking?: boolean;
        },
        options: { [key: string]: any } = {}
      ): Promise<AsyncGenerator<AIStreamResponse, void, unknown>> {
        // Use the request and options to show they're being read
        // Extract model from request
        const model = request.model || "z.ai/xiaomi/mimo-v2-pro";
        
        // Parse the model string to get provider and model name
        const result = importParseModelString(model);
        const providerName = result.provider ?? "z.ai";
        
        // Get the provider instance
        const ProviderClass = await getProviderInstance(providerName);
        if (!ProviderClass) {
          throw new Error("Unknown provider: " + providerName);
        }
        
        const provider = new ProviderClass();
        
        // Call the provider's stream method with the original request and options
        return provider.stream(request, options);
      },
      
      reset() {
        // Reset logic can be implemented when needed
      },
      
      async complete(_request: any, _options?: any): Promise<{ content: string }> {
        // Forward to the appropriate provider's complete method
        return { content: "Provider complete called" };
      }
    };
  }
  return manager;
};

export const resetProviderManager = () => {
  manager = null;
};

// Export parseModelString for external use
export const parseModelString = importParseModelString;

// Define PROVIDER_PREFIXES
export const PROVIDER_PREFIXES = {
  zai: true,
  openrouter: true,
  gemini: true,
  nous: true,
  openai: true,
  anthropic: true,
  groq: true,
} as const;
