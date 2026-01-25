import { For, Show, createMemo, createEffect } from "solid-js";
import { Colors, Indicators } from "../design";
import { useTodo, type Todo } from "../context";

/**
 * TodoPanel Component (replaces TodoBar)
 * Fixed 5-row stacked todo display above the input prompt
 * 
 * Features:
 * - Fixed height of 5 visible task rows + header/border
 * - Stacked vertically (top to bottom)
 * - Alternating row colors for readability
 * - Auto-scroll to in_progress task at top when > 5 items
 * - Counter in upper right: incomplete/total
 * - Collapsed state when all complete
 * - Hidden when no todos exist
 * 
 * Status Display:
 * - [>] in_progress: cyan, normal text
 * - [ ] pending: dim, normal text
 * - [x] completed: dim, normal text
 * - [-] cancelled: dim, strikethrough entire line
 */

// Fixed height constants
const VISIBLE_ROWS = 5;
const PANEL_HEIGHT = VISIBLE_ROWS + 2;  // 5 rows + top/bottom border

// Export for BottomPanel height calculation
export const TODO_PANEL_HEIGHT = PANEL_HEIGHT;

// Sort todos: in_progress first, then pending, then completed, then cancelled
// This ensures the current task is always at the top
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

// Get display properties for a todo status
interface TodoDisplay {
  indicator: string;
  color: string;
  strikethrough: boolean;
}

function getTodoDisplay(status: string): TodoDisplay {
  switch (status) {
    case "in_progress":
      return { 
        indicator: Indicators.todo.in_progress, 
        color: Colors.mode.AGENT,
        strikethrough: false 
      };
    case "completed":
      return { 
        indicator: Indicators.todo.completed, 
        color: Colors.ui.dim, 
        strikethrough: false 
      };
    case "cancelled":
      return { 
        indicator: Indicators.todo.cancelled, 
        color: Colors.ui.dim, 
        strikethrough: true  // Strikethrough entire line for cancelled
      };
    default: // pending
      return { 
        indicator: Indicators.todo.pending, 
        color: Colors.ui.dim, 
        strikethrough: false 
      };
  }
}

// Get alternating row background color
function getRowBackground(index: number): string {
  return index % 2 === 0 ? Colors.todo.rowOdd : Colors.todo.rowEven;
}

export function TodoBar() {
  const { todos, incompleteTodos } = useTodo();
  
  // Sort todos with in_progress at top
  const sortedTodos = createMemo(() => sortTodos(todos()));
  
  // Counts for the header
  const incompleteCount = () => incompleteTodos().length;
  const totalCount = () => todos().length;
  
  // Check if all todos are complete (for collapsed state)
  const allComplete = () => totalCount() > 0 && incompleteCount() === 0;
  
  // Check if we have any todos at all
  const hasTodos = () => totalCount() > 0;
  
  // Scrollbox ref for auto-scrolling
  let scrollboxRef: any;
  
  // Auto-scroll to top when in_progress task changes (keeps current task visible)
  createEffect(() => {
    // Access sortedTodos to create dependency
    const sorted = sortedTodos();
    if (sorted.length > 0 && scrollboxRef?.scrollToTop) {
      scrollboxRef.scrollToTop();
    }
  });

  // Don't render anything if no todos
  if (!hasTodos()) {
    return null;
  }

  return (
    <Show
      when={!allComplete()}
      fallback={
        // Collapsed state when all complete
        <box
          border
          borderColor={Colors.todo.border}
          height={3}
          width="100%"
          flexDirection="row"
          alignItems="center"
        >
          <box paddingLeft={1} flexGrow={1}>
            <text fg={Colors.ui.dim}>{Indicators.collapsed} All tasks complete</text>
          </box>
          <box paddingRight={1}>
            <text fg={Colors.ui.dim}>0/{totalCount()}</text>
          </box>
        </box>
      }
    >
      {/* Active todo panel */}
      <box
        border
        borderColor={Colors.todo.border}
        height={PANEL_HEIGHT}
        width="100%"
        flexDirection="column"
      >
        {/* Header row with title and counter */}
        <box 
          flexDirection="row" 
          height={1}
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={Colors.ui.dim}>Todo</text>
          <box flexGrow={1} />
          <text fg={Colors.ui.dim}>{incompleteCount()}/{totalCount()}</text>
        </box>
        
        {/* Scrollable todo list */}
        <scrollbox
          ref={(r: any) => { scrollboxRef = r; }}
          height={VISIBLE_ROWS}
          flexGrow={1}
          stickyScroll={false}
        >
          <box flexDirection="column">
            <For each={sortedTodos()}>
              {(todo: Todo, index) => {
                const display = () => getTodoDisplay(todo.status);
                const bgColor = () => getRowBackground(index());
                const content = () => `${display().indicator} ${todo.content}`;
                
                return (
                  <box
                    backgroundColor={bgColor()}
                    paddingLeft={1}
                    paddingRight={1}
                    height={1}
                  >
                    <Show
                      when={display().strikethrough}
                      fallback={
                        <text fg={display().color}>{content()}</text>
                      }
                    >
                      {/* Strikethrough entire line for cancelled */}
                      <text fg={display().color}>
                        <s>{content()}</s>
                      </text>
                    </Show>
                  </box>
                );
              }}
            </For>
          </box>
        </scrollbox>
      </box>
    </Show>
  );
}
