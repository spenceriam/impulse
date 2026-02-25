const NEGATIVE_PATTERNS: RegExp[] = [
  /\b(no|nah|nope|deny|denied|decline|declined|reject|rejected|cancel|stop)\b/i,
  /\bdo\s+not\b/i,
  /\bdon't\b/i,
  /\bnot\s+now\b/i,
];

const AFFIRMATIVE_PATTERNS: RegExp[] = [
  /\b(yes|y|ok|okay|approve|approved|proceed|execute|allow|go\s+ahead|start|continue|confirmed)\b/i,
];

/**
 * AUTO approval answers can be freeform text from the question overlay.
 * Accept common affirmative phrases while still rejecting explicit negatives.
 */
export function isAutoApprovalAffirmative(answer: string): boolean {
  const normalized = answer.trim();
  if (!normalized) return false;

  if (NEGATIVE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  return AFFIRMATIVE_PATTERNS.some((pattern) => pattern.test(normalized));
}
