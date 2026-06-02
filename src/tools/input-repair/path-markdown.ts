/** Degenerate auto-link: path prefix + [filename](url) where url mirrors the filename, with optional trailing content. */
export const DEGENERATE_PATH_LINK =
  /^(.*)\[([^\]/\\]+)\]\((?:https?:\/\/|file:\/\/)?([^)/\\]+)\)(.*)$/;

/**
 * Unwrap a degenerate Markdown auto-link path, or null if not applicable.
 */
export function unwrapDegeneratePath(value: string): string | null {
  const match = value.match(DEGENERATE_PATH_LINK);
  if (!match) return null;

  const [, prefix, linkText, urlTarget, suffix] = match;
  const normalizedLink = linkText!.trim();
  const normalizedUrl = urlTarget!.trim();

  if (normalizedLink !== normalizedUrl) return null;

  const unwrapped = `${prefix ?? ""}${normalizedLink}${suffix ?? ""}`;
  return unwrapped === value ? null : unwrapped;
}

export function hasDegeneratePathMarkdown(value: string): boolean {
  return unwrapDegeneratePath(value) !== null;
}
