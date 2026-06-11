/**
 * Provider-agnostic session stickiness for stable system-prompt cache keys.
 */

let pinnedSystemPrompt: string | undefined;

export function pinSystemPromptForTurn(prompt: string): void {
  pinnedSystemPrompt = prompt;
}

export function getPinnedSystemPrompt(): string | undefined {
  return pinnedSystemPrompt;
}

export function clearPinnedSystemPrompt(): void {
  pinnedSystemPrompt = undefined;
}
