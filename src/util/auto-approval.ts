/**
 * Parse approval answers from the question tool in AUTO mode.
 * Option labels are often phrases (e.g. "Yes, execute"), not exact tokens.
 */
export function isAutoApprovalAffirmed(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  if (!normalized) return false;

  // Explicit denials should always win.
  if (
    /\b(no|cancel|stop|deny|denied|reject|decline|do not|don't|not now|hold off)\b/.test(
      normalized
    )
  ) {
    return false;
  }

  return /\b(yes|y|approve|approved|ok|okay|proceed|continue|go ahead|start|execute|run|allow)\b/.test(
    normalized
  );
}
