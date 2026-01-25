import { For, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { Colors, Indicators } from "../design";
import { useTodo, type Todo } from "../context/todo";

/**
 * Todo Overlay Component
 * Shows all todos in a modal overlay (triggered by /todo command)
 * 
 * This is useful when the TodoBar is hidden (all tasks complete)
 * to review what was accomplished in the session.
 */

interface TodoOverlayProps {
  onClose: () => void;
}

// Get status indicator and color for a todo
function getStatusDisplay(status: Todo["status"]): { indicator: string; color: string } {
  switch (status) {
    case "pending":
      return { indicator: Indicators.todo.pending, color: Colors.ui.dim };
    case "in_progress":
      return { indicator: Indicators.todo.in_progress, color: Colors.ui.primary };
    case "completed":
      return { indicator: Indicators.todo.completed, color: Colors.status.success };
    case "cancelled":
      return { indicator: Indicators.todo.cancelled, color: Colors.ui.dim };
    default:
      return { indicator: "[ ]", color: Colors.ui.dim };
  }
}

// Get priority indicator
function getPriorityIndicator(priority: Todo["priority"]): string {
  switch (priority) {
    case "high":
      return "!";
    case "medium":
      return "-";
    case "low":
      return " ";
    default:
      return " ";
  }
}

export function TodoOverlay(props: TodoOverlayProps) {
  const { todos } = useTodo();
  
  // Close on Escape
  useKeyboard((key) => {
    if (key.name === "escape") {
      props.onClose();
    }
  });
  
  // Calculate stats
  const completedCount = () => todos().filter(t => t.status === "completed").length;
  const totalCount = () => todos().length;
  
  return (
    <box
      position="absolute"
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      {/* Semi-transparent backdrop */}
      <box
        position="absolute"
        width="100%"
        height="100%"
        backgroundColor="#000000"
      />
      
      {/* Overlay content */}
      <box
        border
        borderColor={Colors.ui.dim}
        backgroundColor="#1a1a1a"
        width={60}
        minHeight={10}
        maxHeight={30}
        flexDirection="column"
        padding={1}
      >
        {/* Header */}
        <box flexDirection="row" marginBottom={1}>
          <text>
            <strong>Todo List</strong>
          </text>
          <text fg={Colors.ui.dim}> ({completedCount()}/{totalCount()} completed)</text>
        </box>
        
        {/* Todo list */}
        <Show
          when={todos().length > 0}
          fallback={
            <text fg={Colors.ui.dim}>No todos in this session</text>
          }
        >
          <scrollbox height={20} focused>
            <For each={todos()}>
              {(todo) => {
                const { indicator, color } = getStatusDisplay(todo.status);
                const priorityIndicator = getPriorityIndicator(todo.priority);
                const isCancelled = todo.status === "cancelled";
                
                return (
                  <box flexDirection="row" height={1}>
                    <text fg={color}>{indicator} </text>
                    <text fg={todo.priority === "high" ? Colors.status.warning : Colors.ui.dim}>
                      {priorityIndicator}{" "}
                    </text>
                    <Show
                      when={!isCancelled}
                      fallback={
                        <text fg={Colors.ui.dim}>
                          <s>{todo.content}</s>
                        </text>
                      }
                    >
                      <text fg={Colors.ui.text}>{todo.content}</text>
                    </Show>
                  </box>
                );
              }}
            </For>
          </scrollbox>
        </Show>
        
        {/* Footer */}
        <box marginTop={1}>
          <text fg={Colors.ui.dim}>Press Esc to close</text>
        </box>
      </box>
    </box>
  );
}
