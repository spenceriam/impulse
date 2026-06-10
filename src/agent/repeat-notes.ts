/**
 * Inline relational notes appended to repeated tool results within a turn.
 */

const BASH_REPEAT_FULL_NOTE =
  "\nNote: identical command already run this turn — output unchanged unless files changed. Avoid re-verifying; finish your summary.";

const TODO_UNCHANGED_REPEAT_NOTE =
  "\nNote: todo_write already returned unchanged this turn — do not resubmit; continue with the next task.";

/** Full note on 2nd identical bash; short counter on 3rd+. */
export function bashRepeatNote(repeatCount: number): string | undefined {
  if (repeatCount < 2) return undefined;
  if (repeatCount === 2) return BASH_REPEAT_FULL_NOTE;
  return `\nNote: command run ${repeatCount} times this turn.`;
}

/** Note on 2nd+ consecutive todo_write unchanged result in the same turn. */
export function todoUnchangedRepeatNote(consecutiveCount: number): string | undefined {
  if (consecutiveCount < 2) return undefined;
  return TODO_UNCHANGED_REPEAT_NOTE;
}

/** Count items that jumped pending -> completed in one call (matched by content). */
export function countPendingToCompleted(
  current: Array<{ content: string; status: string }>,
  incoming: Array<{ content: string; status: string }>
): number {
  const currentByContent = new Map(current.map((todo) => [todo.content, todo.status]));
  let count = 0;
  for (const todo of incoming) {
    const previous = currentByContent.get(todo.content);
    if (previous === "pending" && todo.status === "completed") {
      count++;
    }
  }
  return count;
}

/** Relational note when many items batch-complete in one todo_write call. */
export function batchCompletionNote(count: number): string | undefined {
  if (count < 3) return undefined;
  return `\nNote: ${count} items jumped pending -> completed in one call. Update statuses in real time as you work — mark in_progress when starting, completed when done, one at a time.`;
}
