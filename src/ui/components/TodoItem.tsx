import { Colors, Indicators } from "../design";

/**
 * Todo type
 */
export interface Todo {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "high" | "medium" | "low";
}

/**
 * Todo Item Component
 * Individual todo display with ASCII status indicators
 * 
 * Props:
 * - todo: Todo to display
 */

interface TodoItemProps {
  todo: Todo;
}

export function TodoItem(props: TodoItemProps) {
  const indicator = () => Indicators.todo[props.todo.status];
  const color = () =>
    props.todo.status === "in_progress"
      ? Colors.mode.WORK
      : Colors.ui.dim;

  return (
    <text fg={color()}>
      {indicator()} {props.todo.content}
    </text>
  );
}
