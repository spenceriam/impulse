/**
 * Parse `!cmd` and `@ question` inputs for user shell runs.
 */

/** `!ls`, `! ls`, `!  pwd` → command body */
export function parseBangCommand(input: string): string | null {
  const trimmed = input.trim();
  const match = /^!\s*(.+)$/.exec(trimmed);
  if (!match) return null;
  const command = match[1]!.trim();
  return command.length > 0 ? command : null;
}

/** `@ question` (no leading !) */
export function parseAtReview(input: string): string | null {
  const trimmed = input.trim();
  const match = /^@\s+(.+)$/.exec(trimmed);
  if (!match) return null;
  const question = match[1]!.trim();
  return question.length > 0 ? question : null;
}

export function isLoneBang(input: string): boolean {
  return input.trim() === "!";
}
