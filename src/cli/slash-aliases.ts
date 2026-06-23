/**
 * Short slash-command aliases.
 *
 * Keys and values are bare slugs (without the leading `/`). Keep aliases hidden
 * from command lists; dispatch and Tab completion resolve them to canonical
 * commands.
 */
export const SLASH_ALIASES = {
  aa: "allow-all",
  cl: "clear",
  cpt: "compact",
  ex: "exit",
  exp: "experimental",
  h: "help",
  mdl: "model",
  mod: "mode",
  n: "new",
  q: "quit",
  rs: "resume",
  ss: "sessions",
  rst: "restore",
  set: "settings",
  str: "steer",
  upd: "update",
  usg: "usage",
  usr: "user",
  dg: "debug",
  sd: "side",
  cpy: "copy",
  sh: "show",
  ad: "advisor",
  ckp: "checkpoint",
  un: "undo",
  rd: "redo",
  gl: "goal",
} as const;

export type SlashAlias = keyof typeof SLASH_ALIASES;
export type SlashAliasTarget = (typeof SLASH_ALIASES)[SlashAlias];

export function slashAliasTarget(cmd: string): string | null {
  return (SLASH_ALIASES as Record<string, string | undefined>)[cmd] ?? null;
}

export function resolveSlashAlias(cmd: string): string {
  return slashAliasTarget(cmd) ?? cmd;
}

/** Rewrite the first slash token from an exact alias to its canonical command. */
export function canonicalizeSlashAliasInput(input: string): string {
  const leading = input.match(/^\s*/)?.[0] ?? "";
  const rest = input.slice(leading.length);
  if (!rest.startsWith("/")) return input;

  const token = rest.split(/\s+/)[0] ?? "";
  if (!token.startsWith("/") || token.length <= 1) return input;

  const target = slashAliasTarget(token.slice(1).toLowerCase());
  if (!target) return input;

  const afterToken = rest.slice(token.length);
  return `${leading}/${target}${afterToken}`;
}

export function aliasesForCommand(commandSlug: string): string[] {
  return Object.entries(SLASH_ALIASES)
    .filter(([, target]) => target === commandSlug)
    .map(([alias]) => `/${alias}`)
    .sort((a, b) => a.localeCompare(b));
}
