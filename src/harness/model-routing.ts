/**
 * Canonical impulse model ID — provider slug translation at adapter boundary.
 */

/** Normalize stored model id (provider/model or bare model). */
export function canonicalImpulseModelId(
  model: string,
  defaultProvider: string
): string {
  const trimmed = model.trim();
  if (!trimmed) return "";
  if (trimmed.includes("/")) return trimmed;
  return `${defaultProvider}/${trimmed}`;
}
