/**
 * CLI startup flags parsed before TUI init.
 */

export interface StartupFlags {
  allowAllOnStartup: boolean;
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
