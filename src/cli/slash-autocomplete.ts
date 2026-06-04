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

  // e.g. token /show → still list /show-think even though /show is an exact match
  const extensions = matches.filter((c) => c.cmd.toLowerCase().length > token.length);
  if (extensions.length > 0) {
    return { show: true, matches: extensions };
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

/** Cycle state for Tab through ambiguous slash commands (e.g. /show vs /show-think). */
export type SlashCompleteCycle = { prefix: string; index: number };

function replaceSlashToken(input: string, newToken: string): string {
  const leading = input.match(/^\s*/)?.[0] ?? "";
  const rest = input.slice(leading.length);
  const token = rest.split(/\s+/)[0] ?? "";
  const afterToken = rest.slice(token.length);
  return `${leading}${newToken}${afterToken}`;
}

function prefixMatchesForToken(
  commands: SlashCommandEntry[],
  token: string
): SlashCommandEntry[] {
  return commands
    .filter((c) => c.cmd.toLowerCase().startsWith(token))
    .sort((a, b) => a.cmd.localeCompare(b.cmd));
}

function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return "";
  let prefix = strings[0]!.toLowerCase();
  for (const s of strings.slice(1)) {
    const lower = s.toLowerCase();
    while (prefix.length > 0 && !lower.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
  }
  const first = strings[0]!;
  return first.slice(0, prefix.length);
}

/**
 * Tab-complete the slash token: unique match, shared prefix extension, or cycle ambiguities.
 */
export function completeSlashCommandTab(
  input: string,
  commands: SlashCommandEntry[],
  cycle: SlashCompleteCycle | null
): { text: string | null; nextCycle: SlashCompleteCycle | null } {
  const token = slashCommandToken(input);
  if (token === null) return { text: null, nextCycle: null };

  const tokenLower = token.toLowerCase();

  if (cycle && tokenLower.startsWith(cycle.prefix)) {
    const cycleMatches = prefixMatchesForToken(commands, cycle.prefix);
    if (cycleMatches.length > 1) {
      const nextIndex = (cycle.index + 1) % cycleMatches.length;
      const chosen = cycleMatches[nextIndex]!.cmd;
      if (chosen.toLowerCase() !== tokenLower) {
        return {
          text: replaceSlashToken(input, chosen),
          nextCycle: { prefix: cycle.prefix, index: nextIndex },
        };
      }
    }
  }

  const matches = prefixMatchesForToken(commands, token);
  if (matches.length === 0) return { text: null, nextCycle: null };

  if (matches.length === 1) {
    const full = matches[0]!.cmd;
    if (full.toLowerCase() === token) return { text: null, nextCycle: null };
    return { text: replaceSlashToken(input, full), nextCycle: null };
  }

  const lcp = longestCommonPrefix(matches.map((m) => m.cmd));
  if (lcp.length > token.length) {
    return { text: replaceSlashToken(input, lcp), nextCycle: null };
  }

  let nextIndex = 0;
  const exactIndex = matches.findIndex((m) => m.cmd.toLowerCase() === tokenLower);
  if (exactIndex >= 0) {
    nextIndex = (exactIndex + 1) % matches.length;
  }

  const chosen = matches[nextIndex]!.cmd;
  if (chosen.toLowerCase() === tokenLower) {
    return { text: null, nextCycle: null };
  }

  return {
    text: replaceSlashToken(input, chosen),
    nextCycle: { prefix: tokenLower, index: nextIndex },
  };
}

/**
 * Complete when exactly one command matches (legacy helper).
 */
export function completeSlashCommand(
  input: string,
  commands: SlashCommandEntry[]
): string | null {
  return completeSlashCommandTab(input, commands, null).text;
}
