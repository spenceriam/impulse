/** True when todo_write produced a real list change (not an unchanged no-op). */
export function isTodoWriteRealUpdate(toolName: string, output: string): boolean {
  if (toolName !== "todo_write") return false;
  return output.startsWith("Todo list updated.");
}
