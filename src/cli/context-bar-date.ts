/**
 * Locale-aware date formatting for the context bar footer (system LANG/LC_TIME).
 */

/** Short date for the current locale (e.g. en-US → 5/29/26). */
export function formatContextBarDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short" }).format(now);
}

/** Plain `v{version} | {date}` (no ANSI). */
export function formatContextBarRight(version: string, now: Date = new Date()): string {
  return `v${version} | ${formatContextBarDate(now)}`;
}

/** Version only for reduced bottom bar mode (no ANSI). */
export function formatContextBarVersionOnly(version: string): string {
  return `v${version}`;
}
