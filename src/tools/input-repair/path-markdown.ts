/** Degenerate auto-link: path prefix + [filename](url) where url mirrors the filename. */
export const DEGENERATE_PATH_LINK =
  /^(.*)\[([^\]/\\]+)\]\((?:https?:\/\/|file:\/\/)?([^)/\\]+)\)$/;

/**
 * Unwrap a degenerate Markdown auto-link path, or null if not applicable.
 */
export function unwrapDegeneratePath(value: string): string | null {
  const match = value.match(DEGENERATE_PATH_LINK);
  if (!match) return null;

  const [, prefix, linkText, urlTarget] = match;
  const normalizedLink = linkText!.trim();
  const normalizedUrl = urlTarget!.trim();

  if (normalizedLink !== normalizedUrl) return null;

  const unwrapped = `${prefix ?? ""}${normalizedLink}`;
  return unwrapped === value ? null : unwrapped;
}

export function hasDegeneratePathMarkdown(value: string): boolean {
  // Skip validation for empty strings or very short values
  if (!value || value.length < 3) return false;
  
  // Quick heuristic: legitimate Windows absolute paths should never be considered markdown
  // Pattern: C:\ or C:/ at start, or UNC paths \\server\share
  if (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value)) {
    // But still check if there's a markdown link embedded later in the path
    const linkIndex = value.indexOf('[');
    if (linkIndex === -1) return false;
  }
  
  return unwrapDegeneratePath(value) !== null;
}
