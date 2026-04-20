import { AIProvider, AIStreamResponse } from '../provider';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Portable key resolver — checks in order:
//   1. OPENROUTER_API_KEY in process.env
//   2. project-root .env
//   3. ~/.impulse/.env
// ---------------------------------------------------------------------------

function findProjectRootEnv(): string | null {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, '.env');
      if (fs.existsSync(candidate)) return candidate;
      dir = path.dirname(dir);
    }
  } catch {}
  return null;
}

function keyFromEnvFile(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('OPENROUTER_API_KEY=')) {
        return trimmed.split('=').slice(1).join('=').trim();
      }
    }
  } catch {}
  return '';
}

function resolveOpenRouterKey(): string {
  // 1. Environment variable
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;

  // 2. Project .env
  const projectEnv = findProjectRootEnv();
  if (projectEnv) {
    const key = keyFromEnvFile(projectEnv);
    if (key) return key;
  }

  // 3. ~/.impulse/.env
  const homeEnv = path.join(
    process.env.HOME || process.env.USERPROFILE || '',
    '.impulse',
    '.env'
  );
  const homeKey = keyFromEnvFile(homeEnv);
  if (homeKey) return homeKey;

  return '';
}

export class OpenRouterProvider implements AIProvider {
  name = 'openrouter';

  private key(): string {
    return resolveOpenRouterKey();
  }

  private endpoint(): string {
    return process.env.NOUS_ENDPOINT || 'https://openrouter.ai/api/v1';
  }

  /** Strip "openrouter/" prefix if present */
  private parseModel(raw: string): string {
    return raw.startsWith('openrouter/') ? raw.slice('openrouter/'.length) : raw;
  }

  async *stream(
    request: { messages: { role: string; content: string }[]; model?: string; thinking?: boolean },
    _options: { [key: string]: any }
  ): AsyncGenerator<AIStreamResponse, void, unknown> {
    const apiKey = this.key();
    if (!apiKey) {
      yield { content: '\nOpenRouterProvider: no API key found.', done: true };
      yield { content: 'Create ~/.impulse/.env with OPENROUTER_API_KEY=<your key>', done: false };
      yield { content: 'Or put a .env in the project root with OPENROUTER_API_KEY=<your key>', done: true };
      return;
    }

    const endpoint = this.endpoint();
    const model = this.parseModel(request.model || '');
    if (!model) {
      yield { content: '\nOpenRouterProvider: no model specified.', done: true };
      return;
    }

    const payload = {
      model: model,
      messages: request.messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: 1000,
    };

    try {
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.text();
        yield { content: `\nOpenRouter error ${res.status}: ${err}`, done: true };
        return;
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content ?? '(no response)';
      yield { content: content.trim(), done: true };
    } catch (err) {
      yield { content: `\nOpenRouter fetch error: ${err}`, done: true };
    }
  }

  async complete(
    request: any,
    _options?: any
  ): Promise<{ content: string }> {
    const apiKey = this.key();
    if (!apiKey) return { content: 'OpenRouterProvider: no API key found.' };

    const endpoint = this.endpoint();
    const model = this.parseModel(request.model || '');

    try {
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
    } catch (err) {
      return { content: `OpenRouter fetch error: ${err}` };
    }
  }
}
