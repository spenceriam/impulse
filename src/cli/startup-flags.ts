/**
 * CLI startup flags parsed before TUI init.
 */

export interface StartupFlags {
  allowAllOnStartup: boolean;
}

/** Boolean flags (no value). */
export const KNOWN_BOOLEAN_FLAGS = new Set([
  "--version",
  "-v",
  "--update",
  "--help",
  "-h",
  "--setup",
  "--list-sessions",
  "--enrich-session-titles",
  "--dry-run",
  "--aa",
  "--allow-all",
  "--resume",
  "-r",
]);

/** Flags that consume the following token as a value. */
export const VALUE_FLAGS = new Set(["--limit", "--project"]);

/** Returns the first unrecognized flag token, or undefined. Honors `--` end-of-options. */
export function findUnknownFlag(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") return undefined;
    if (!a.startsWith("-")) continue;
    if (KNOWN_BOOLEAN_FLAGS.has(a) || VALUE_FLAGS.has(a)) {
      if (VALUE_FLAGS.has(a)) i++;
      continue;
    }
    return a;
  }
  return undefined;
}

export function parseStartupFlags(argv: string[]): { flags: StartupFlags; argv: string[] } {
  let allowAllOnStartup =
    argv.includes("--aa") ||
    argv.includes("--allow-all") ||
    process.env["IMPULSE_ALLOW_ALL"] === "1";

  const argvOut: string[] = [];
  for (const arg of argv) {
    if (arg === "--aa" || arg === "--allow-all") continue;
    argvOut.push(arg);
  }

  return {
    flags: { allowAllOnStartup },
    argv: argvOut,
  };
}
