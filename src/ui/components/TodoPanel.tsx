import { For, Show } from "solid-js";
import { Colors, Indicators } from "../design";
import { useTodo, type Todo } from "../context";

/**
 * TodoPanel Component
 * Compact todo list with scrollbox, bordered, for the 30% bottom panel
 * 
 * Features:
 * - In-progress todos sorted to top
 * - Completed todos show strikethrough
 * - Scrollable when items exceed visible area
 * - Full border around panel
 */

// Sort todos: in_progress first, then pending, then completed/cancelled
function sortTodos(todos: Todo[]): Todo[] {
  const priority: Record<string, number> = {
    in_progress: 0,
    pending: 1,
    completed: 2,
    cancelled: 3,
  };
  return [...todos].sort((a, b) => 
    (priority[a.status] ?? 99) - (priority[b.status] ?? 99)
  );
}

// Get indicator and color for todo status
function getTodoDisplay(status: string): { indicator: string; color: string; strikethrough: boolean } {
  switch (status) {
    case "in_progress":
      return { indicator: Indicators.todo.in_progress, color: Colors.mode.AGENT, strikethrough: false };
    case "completed":
      return { indicator: Indicators.todo.completed, color: Colors.ui.dim, strikethrough: true };
    case "cancelled":
      return { indicator: Indicators.todo.cancelled, color: Colors.ui.dim, strikethrough: true };
    default: // pending
      return { indicator: Indicators.todo.pending, color: Colors.ui.dim, strikethrough: false };
  }
}

interface TodoPanelProps {
  height?: number;  // Panel height (default 7 to match input area)
}

export function TodoPanel(props: TodoPanelProps) {
  const { todos, incompleteTodos } = useTodo();
  
  const sortedTodos = () => sortTodos(todos());
  const height = () => props.height ?? 7;
  const contentHeight = () => height() - 2; // Subtract border

  return (
    <box
      border
      title={`Todo${incompleteTodos().length > 0 ? ` (${incompleteTodos().length})` : ""}`}
      titleAlignment="left"
      flexDirection="column"
      height={height()}
      width="100%"
    >
      <scrollbox
        height={contentHeight()}
        focused={false}
      >
        <box flexDirection="column" paddingLeft={1} paddingRight={1}>
          <For each={sortedTodos()}>
            {(todo: Todo) => {
              const display = () => getTodoDisplay(todo.status);
              return (
                <box flexDirection="row">
                  <text fg={display().color}>
                    {display().indicator}{" "}
                  </text>
                  <Show
                    when={display().strikethrough}
                    fallback={<text fg={display().color}>{todo.content}</text>}
                  >
                    {/* Strikethrough using dim + ~~ markers */}
                    <text fg={Colors.ui.dim}>
                      <s>{todo.content}</s>
                    </text>
                  </Show>
                </box>
              );
            }}
          </For>
          {/* Empty state */}
          <Show when={todos().length === 0}>
            <text fg={Colors.ui.dim}>No tasks</text>
          </Show>
        </box>
      </scrollbox>
    </box>
  );
}
