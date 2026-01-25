import { For, Show, createMemo, createEffect, createSignal } from "solid-js";
import { Colors, Indicators } from "../design";
import { useTodo, type Todo } from "../context";

/**
 * TodoPanel Component
 * Fixed 5-row stacked todo display above the input prompt
 * 
 * Features:
 * - Fixed height of 5 visible task rows + border
 * - Stacked vertically (top to bottom)
 * - Alternating row colors for readability
 * - Auto-scroll to in_progress task at top when > 5 items
 * - Counter on LEFT: "Todo (2/5)"
 * - Collapse button on RIGHT: [−]/[+]
 * - When collapsed: shows current in_progress task only
 * - HIDDEN when all complete or no todos (use /todo to view history)
 * 
 * Status Display:
 * - [>] in_progress: cyan, normal text
 * - [ ] pending: dim, normal text
 * - [✓] completed: dim, normal text
 * - [-] cancelled: dim, strikethrough entire line
 */

// Fixed height constants
const VISIBLE_ROWS = 5;
const PANEL_HEIGHT = VISIBLE_ROWS + 2;  // 5 rows + top/bottom border
const COLLAPSED_HEIGHT = 3;  // Just header + 1 task + border

// Export for BottomPanel height calculation
export const TODO_PANEL_HEIGHT = PANEL_HEIGHT;
export const TODO_COLLAPSED_HEIGHT = COLLAPSED_HEIGHT;

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
  
  // Collapsed state (user can toggle)
  const [collapsed, setCollapsed] = createSignal(false);
  
  // Sort todos with in_progress at top
  const sortedTodos = createMemo(() => sortTodos(todos()));
  
  // Counts for the header
  const incompleteCount = () => incompleteTodos().length;
  const totalCount = () => todos().length;
  
  // Current in_progress task (for collapsed view)
  const currentTask = createMemo(() => {
    return sortedTodos().find(t => t.status === "in_progress") || 
           sortedTodos().find(t => t.status === "pending");
  });
  
  // Check if we should show the panel at all
  // Hide when: no todos OR all todos are complete/cancelled
  const shouldShow = () => incompleteCount() > 0;
  
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

  // Toggle collapse
  const toggleCollapse = () => setCollapsed(c => !c);

  return (
    <Show when={shouldShow()}>
      <Show
        when={!collapsed()}
        fallback={
          // Collapsed view - just show current task
          <box
            border
            borderColor={Colors.todo.border}
            height={COLLAPSED_HEIGHT}
            width="100%"
            flexDirection="column"
          >
            {/* Header with counter on left, expand button on right */}
            <box 
              flexDirection="row" 
              height={1}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={Colors.ui.dim}>Todo ({incompleteCount()}/{totalCount()})</text>
              <box flexGrow={1} />
              <box onMouseDown={toggleCollapse}>
                <text fg={Colors.ui.primary}>[+]</text>
              </box>
            </box>
            
            {/* Current task only */}
            <Show when={currentTask()}>
              {(task: () => Todo) => {
                const display = () => getTodoDisplay(task().status);
                const content = () => `${display().indicator} ${task().content}`;
                return (
                  <box
                    backgroundColor={Colors.todo.rowOdd}
                    paddingLeft={1}
                    paddingRight={1}
                    height={1}
                  >
                    <text fg={display().color}>{content()}</text>
                  </box>
                );
              }}
            </Show>
          </box>
        }
      >
        {/* Expanded view - full todo panel */}
        <box
          border
          borderColor={Colors.todo.border}
          height={PANEL_HEIGHT}
          width="100%"
          flexDirection="column"
        >
          {/* Header with counter on left, collapse button on right */}
          <box 
            flexDirection="row" 
            height={1}
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg={Colors.ui.dim}>Todo ({incompleteCount()}/{totalCount()})</text>
            <box flexGrow={1} />
            <box onMouseDown={toggleCollapse}>
              <text fg={Colors.ui.primary}>[−]</text>
            </box>
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
    </Show>
  );
}
