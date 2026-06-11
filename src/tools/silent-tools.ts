/** Tools that should not render output in the chat transcript (renderer + replay). */
export const SILENT_TOOLS = new Set(["set_header", "todo_read"]);

export function isSilentTool(name: string): boolean {
  return SILENT_TOOLS.has(name);
}
