import { AIProvider, AIStreamResponse } from '../provider';
import * as fs from 'fs';

// Load key from ~/.hermes/.env
function getOpenRouterKey(): string {
  try {
    const envPath = '/home/spencer/.hermes/.env';
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      if (line.startsWith('OPENROUTER_API_KEY=')) {
        return line.split('=').slice(1).join('=').trim();
      }
    }
  } catch {}
  return process.env.OPENROUTER_API_KEY || '';
}

export class OpenRouterProvider implements AIProvider {
  name = 'openrouter';

  async *stream(
    request: { messages: { role: string; content: string }[]; model?: string; thinking?: boolean },
    _options: { [key: string]: any }
  ): AsyncGenerator<AIStreamResponse, void, unknown> {
    const apiKey = getOpenRouterKey();
    const endpoint = process.env.NOUS_ENDPOINT || 'https://openrouter.ai/api/v1';
    // Strip the "openrouter/" prefix from the model string
    const rawModel = request.model || 'unknown';
    const model = rawModel.startsWith('openrouter/') ? rawModel.slice('openrouter/'.length) : rawModel;

    const payload = JSON.stringify({
      model: model,
      messages: request.messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: 1000,
    });

    const res = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: payload,
    });

    if (!res.ok) {
      const err = await res.text();
      yield { content: `\nOpenRouter error ${res.status}: ${err}`, done: true };
      return;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? '(no response)';

    yield { content: content.trim(), done: true };
  }

  async complete(
    request: any,
    _options?: any
  ): Promise<{ content: string }> {
    const apiKey = process.env.NOUS_API_KEY || process.env.OPENROUTER_API_KEY || '';
    const endpoint = process.env.NOUS_ENDPOINT || 'https://openrouter.ai/api/v1';
    const model = request.model || 'unknown';

    const res = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: request.messages.map((m: any) => ({ role: m.role, content: m.content })),
        max_tokens: 1000,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { content: `OpenRouter error ${res.status}: ${err}` };
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? '(no response)';
    return { content: content.trim() };
  }
}
