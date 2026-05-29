/** Reject answer-echo or numeric-only session header titles. */
export function isWeakHeaderTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return true;
  if (t.length < 3) return true;
  if (/^#?\s*[\d.,\s]+$/.test(t)) return true;
  if (/^\d+$/.test(t)) return true;
  return false;
}
