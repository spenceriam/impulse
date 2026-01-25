import { Show } from "solid-js";
import { InputArea, type CommandCandidate } from "./InputArea";
import { TodoBar, TODO_PANEL_HEIGHT } from "./TodoBar";
import { useTodo } from "../context";
import { type Mode } from "../design";

/**
 * BottomPanel Component
 * Vertical stack: optional todo panel ABOVE prompt
 * 
 * Layout (v0.23.0 redesign):
 * - When todos exist: Fixed 7-row todo panel above input (5 tasks + border)
 * - When all complete: Collapsed 3-row "All tasks complete" message
 * - When no todos: just input (panel hidden)
 * 
 * Height Calculation for InputArea (borderless design):
 * - top accent line: 1 row
 * - spacer: 1 row (breathing room)
 * - textarea content: 5 rows
 * - bottom accent line: 1 row
 * - Total: 1 + 1 + 5 + 1 = 8 rows
 * 
 * Total with active todos: 7 (todo panel) + 8 (input) = 15 rows
 * Total with all complete: 3 (collapsed) + 8 (input) = 11 rows
 * Total without todos: 8 rows
 * 
 * Structure:
 * ┌─ Todo ──────────────────────────────────────────────── 2/5 ───┐
 * │ [>] Current task                                              │ <- alternating bg
 * │ [ ] Next task                                                 │
 * │ [ ] Another task                                              │
 * │ [x] Completed task                                            │
 * │ [-] Cancelled task                                            │ <- strikethrough
 * └───────────────────────────────────────────────────────────────┘
 * ▄▄▄ AGENT > GLM-4.7 ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
 * > _
 * ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
 */

// Height calculation: accent(1) + spacer(1) + textarea(5) + accent(1) = 8
const TEXTAREA_HEIGHT = 5;
const ACCENT_HEIGHT = 2;  // Top + bottom accent lines
const SPACER_HEIGHT = 1;  // Breathing room below top accent
const INPUT_HEIGHT = TEXTAREA_HEIGHT + ACCENT_HEIGHT + SPACER_HEIGHT;  // 8 rows
const COLLAPSED_TODO_HEIGHT = 3;  // "All tasks complete" collapsed state

// Export panel height for Gutter calculations (dynamic based on todos)
export const BOTTOM_PANEL_HEIGHT = INPUT_HEIGHT;  // Base height without todos

interface BottomPanelProps {
  mode: Mode;
  model: string;  // Current model name
  thinking: boolean;
  loading: boolean;
  overlayActive?: boolean;  // When true, unfocus input (overlay is showing)
  onSubmit: (value: string) => void;
  onAutocompleteChange: (data: { commands: CommandCandidate[]; selectedIndex: number } | null) => void;
}

export function BottomPanel(props: BottomPanelProps) {
  const { todos, incompleteTodos } = useTodo();
  
  // Check if we have any todos at all
  const hasTodos = () => todos().length > 0;
  
  // Check if all todos are complete (for collapsed state)
  const allComplete = () => hasTodos() && incompleteTodos().length === 0;
  
  // Dynamic height based on todo state:
  // - No todos: just input (8 rows)
  // - All complete: collapsed panel (3 rows) + input (8 rows) = 11 rows
  // - Active todos: full panel (7 rows) + input (8 rows) = 15 rows
  const panelHeight = () => {
    if (!hasTodos()) return INPUT_HEIGHT;
    if (allComplete()) return COLLAPSED_TODO_HEIGHT + INPUT_HEIGHT;
    return TODO_PANEL_HEIGHT + INPUT_HEIGHT;
  };

  return (
    <box 
      flexDirection="column"  // Vertical stack: todo panel above input
      height={panelHeight()}
      width="100%"
      minWidth={0}
      overflow="hidden"
    >
      {/* Todo panel - shown when todos exist */}
      <Show when={hasTodos()}>
        <TodoBar />
      </Show>
      
      {/* Input area - full width */}
      <box 
        height={INPUT_HEIGHT}
        width="100%"
        minWidth={0}
        overflow="hidden"
      >
        <InputArea
          mode={props.mode}
          model={props.model}
          thinking={props.thinking}
          loading={props.loading}
          overlayActive={props.overlayActive ?? false}
          onSubmit={props.onSubmit}
          onAutocompleteChange={props.onAutocompleteChange}
          fixedHeight={TEXTAREA_HEIGHT}  // 5 rows of textarea content
        />
      </box>
    </box>
  );
}
