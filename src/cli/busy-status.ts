/**
 * Busy-line status phrases for the turn spinner (above prompt).
 */

export const BUSY_WORKING = "Working...";
export const BUSY_PROCESSING = "Processing...";

/** Fixed phrases that should not be replaced by a generic tool-start status. */
export const FIXED_BUSY_PHRASES = new Set([
  BUSY_PROCESSING,
  "Advisor consultation...",
  "Waiting for your answer...",
  "Waiting for your approval...",
  "Reviewing plan...",
]);

/**
 * Resolve the displayed busy phrase from an internal status key and optional fixed phrase.
 */
export function resolveBusyPhrase(msg: string, fixedPhrase?: string): string {
  if (fixedPhrase) return fixedPhrase;
  const normalized = msg.toLowerCase();
  if (
    normalized.includes("think") ||
    normalized.includes("waiting for model") ||
    normalized.includes("compacting") ||
    normalized.includes("translating") ||
    normalized.includes("responding")
  ) {
    return BUSY_PROCESSING;
  }
  return BUSY_WORKING;
}

export function busyStatusOverridesFixedPhrase(msg: string, fixedPhrase?: string): boolean {
  if (fixedPhrase !== undefined) return true;
  const normalized = msg.toLowerCase();
  return (
    normalized.includes("waiting") ||
    normalized.includes("running ") ||
    normalized.includes("approval") ||
    normalized.includes("compacting") ||
    normalized.includes("translating")
  );
}

export function busyPhraseUsesDimBase(phrase: string, msg: string): boolean {
  return (
    phrase === BUSY_PROCESSING ||
    phrase === "Advisor consultation..." ||
    phrase === "Waiting for your answer..." ||
    phrase === "Waiting for your approval..." ||
    phrase === "Reviewing plan..." ||
    msg.toLowerCase().includes("think")
  );
}
