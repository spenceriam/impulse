/**
 * Slash-command autocomplete visibility (prefix match vs exact command token).
 */

export type SlashCommandEntry = { cmd: string; hint?: string };

export type SlashAutocompleteResult = {
  show: boolean;
  matches: SlashCommandEntry[];
};

/** First whitespace-delimited token when input starts with `/`. */
export function slashCommandToken(input: string): string | null {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) return null;
  const token = trimmed.split(/\s+/)[0];
  return token ? token.toLowerCase() : null;
}

/**
 * Show suggestions for partial prefix matches; hide when token equals a known command.
 */
export function shouldShowSlashAutocomplete(
  input: string,
  commands: SlashCommandEntry[]
): SlashAutocompleteResult {
  const token = slashCommandToken(input);
  if (token === null) {
    return { show: false, matches: [] };
  }

  const matches = commands.filter((c) => c.cmd.toLowerCase().startsWith(token));
  if (matches.length === 0) {
    return { show: false, matches: [] };
  }

  const hasExactMatch = matches.some((c) => c.cmd.toLowerCase() === token);
  if (hasExactMatch) {
    return { show: false, matches };
  }

  return { show: true, matches };
}

/** True when the prompt is entering or editing a slash command. */
export function isSlashCommandInput(input: string): boolean {
  return input.trimStart().startsWith("/");
}

/**
 * Complete the first slash token when exactly one command matches the prefix.
 * Returns null when there are zero or multiple matches, or the token is already complete.
 */
export function completeSlashCommand(
  input: string,
  commands: SlashCommandEntry[]
): string | null {
  const token = slashCommandToken(input);
  if (token === null) return null;

  const matches = commands.filter((c) => c.cmd.toLowerCase().startsWith(token));
  if (matches.length !== 1) return null;

  const full = matches[0]!.cmd;
  if (full.toLowerCase() === token) return null;

  const leading = input.match(/^\s*/)?.[0] ?? "";
  const rest = input.slice(leading.length);
  const afterToken = rest.slice(token.length);
  return `${leading}${full}${afterToken}`;
}
