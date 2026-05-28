/**
 * Strip model-specific tool-call markup from thinking streams before UI display.
 */

const DSML_PATTERN = /<\|[^|]+\|>/g;
const TOOL_XML_PATTERN = /<\|?\s*DSML\s*\|?[^>]*>/gi;

export function filterThinkingForDisplay(text: string): string {
  if (!text) return text;
  let out = text.replace(DSML_PATTERN, "");
  out = out.replace(TOOL_XML_PATTERN, "");
  return out;
}
