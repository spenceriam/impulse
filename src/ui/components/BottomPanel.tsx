import { InputArea, type CommandCandidate } from "./InputArea";
import { TodoBar, TODO_PANEL_HEIGHT } from "./TodoBar";
import { useTodo } from "../context";
import { type Mode } from "../design";

/**
 * BottomPanel Component
 * Vertical stack: optional todo panel ABOVE prompt
 * 
 * Layout (v0.24.0 update):
 * - When incomplete todos exist: Todo panel above input
 *   - Expanded: 7 rows (5 tasks + border)
 *   - Collapsed: 3 rows (header + 1 task + border)
 * - When all complete or no todos: HIDDEN (use /todo to view history)
 * 
 * Height Calculation for InputArea (borderless design):
 * - top accent line: 1 row
 * - spacer: 1 row (breathing room)
 * - textarea content: 5 rows
 * - bottom accent line: 1 row
 * - Total: 1 + 1 + 5 + 1 = 8 rows
 * 
 * Structure (expanded):
 * ┌─ Todo (2/5) ──────────────────────────────────────────── [−] ─┐
 * │ [>] Current task                                              │
 * │ [ ] Next task                                                 │
 * │ [ ] Another task                                              │
 * │ [✓] Completed task                                            │
 * │ [-] Cancelled task                                            │ <- strikethrough
 * └───────────────────────────────────────────────────────────────┘
 * 
 * Structure (collapsed):
 * ┌─ Todo (2/5) ──────────────────────────────────────────── [+] ─┐
 * │ [>] Current task                                              │
 * └───────────────────────────────────────────────────────────────┘
 */

// Height calculation: accent(1) + spacer(1) + textarea(5) + accent(1) = 8
const TEXTAREA_HEIGHT = 5;
const ACCENT_HEIGHT = 2;  // Top + bottom accent lines
const SPACER_HEIGHT = 1;  // Breathing room below top accent
const INPUT_HEIGHT = TEXTAREA_HEIGHT + ACCENT_HEIGHT + SPACER_HEIGHT;  // 8 rows

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
  const { incompleteTodos } = useTodo();
  
  // Only show todo panel when there are incomplete todos
  // (TodoBar handles its own visibility, but we need height calculation)
  const hasIncompleteTodos = () => incompleteTodos().length > 0;

  // For now, assume expanded state for height calculation
  // TODO: Could track collapsed state here if needed for precise height
  const panelHeight = () => {
    if (!hasIncompleteTodos()) return INPUT_HEIGHT;
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
      {/* Todo panel - handles its own visibility based on incomplete todos */}
      <TodoBar />
      
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
