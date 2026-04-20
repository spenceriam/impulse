import { AIProvider } from '../provider';

export async function getProviderInstance(providerName: string): Promise<new () => AIProvider> {
  switch (providerName) {
    case 'z.ai': {
      const m = await import('./zai');
      return m.ZAIProvider;
    }
    case 'openrouter': {
      const m = await import('./openrouter');
      return m.OpenRouterProvider;
    }
    case 'gemini': {
      const m = await import('./gemini');
      return m.GeminiProvider;
    }
    case 'nous': {
      const m = await import('./nous');
      return m.NousProvider;
    }
    case 'openai': {
      const m = await import('./openai');
      return m.OpenAIProvider;
    }
    case 'anthropic': {
      const m = await import('./anthropic');
      return m.AnthropicProvider;
    }
    case 'groq': {
      const m = await import('./groq');
      return m.GroqProvider;
    }
    default:
      throw new Error('Unknown provider: ' + providerName);
  }
}
