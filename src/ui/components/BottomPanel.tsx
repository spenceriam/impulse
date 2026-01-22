import { Show } from "solid-js";
import { InputArea, type CommandCandidate } from "./InputArea";
import { TodoPanel } from "./TodoPanel";
import { useTodo } from "../context";
import { type Mode } from "../design";

/**
 * BottomPanel Component
 * Fixed-height bottom section with 70/30 split (prompt/todos)
 * 
 * Layout:
 * - When todos exist: 70% prompt box, 30% todo panel
 * - When no todos: 100% prompt box
 * - Fixed height of 8 rows (see height calculation below)
 * 
 * Height Calculation for InputArea (new borderless design):
 * - top accent line: 1 row
 * - spacer: 1 row (breathing room)
 * - textarea content: 5 rows
 * - bottom accent line: 1 row
 * - Total: 1 + 1 + 5 + 1 = 8 rows
 * 
 * Note: Spinner column removed - spinner now in Gutter component
 * 
 * Structure:
 * ┌─────────────────────────────────────────────┬───────────┐
 * │ ▄▄▄ AUTO > GLM-4.7 ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄ │┌─ Todo ──┐│
 * │                                             ││ [>] Task││
 * │ > _                                         ││ [ ] Next││
 * │                                             ││         ││
 * │                                             ││         ││
 * │ ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ │└─────────┘│
 * └─────────────────────────────────────────────┴───────────┘
 */

// Height calculation: accent(1) + spacer(1) + textarea(5) + accent(1) = 8
const TEXTAREA_HEIGHT = 5;
const ACCENT_HEIGHT = 2;  // Top + bottom accent lines
const SPACER_HEIGHT = 1;  // Breathing room below top accent
const PANEL_HEIGHT = TEXTAREA_HEIGHT + ACCENT_HEIGHT + SPACER_HEIGHT;  // 8 rows

const PROMPT_WIDTH_PERCENT = 70;
const TODO_WIDTH_PERCENT = 30;

// Export panel height for Gutter calculations
export const BOTTOM_PANEL_HEIGHT = PANEL_HEIGHT;

interface BottomPanelProps {
  mode: Mode;
  thinking: boolean;
  loading: boolean;
  onSubmit: (value: string) => void;
  onAutocompleteChange: (data: { commands: CommandCandidate[]; selectedIndex: number } | null) => void;
}

export function BottomPanel(props: BottomPanelProps) {
  const { todos } = useTodo();
  
  // Show todo panel only when there are todos
  const hasTodos = () => todos().length > 0;

  return (
    <box 
      flexDirection="row" 
      height={PANEL_HEIGHT}
      width="100%"
      minWidth={0}
      overflow="hidden"
    >
      {/* Prompt + Todo split - no spinner column (moved to Gutter) */}
      <box flexDirection="row" flexGrow={1} minWidth={0} overflow="hidden">
        {/* Prompt box - 70% or 100% depending on todos */}
        <box 
          width={hasTodos() ? `${PROMPT_WIDTH_PERCENT}%` : "100%"}
          height={PANEL_HEIGHT}
          minWidth={0}
          overflow="hidden"
        >
          <InputArea
            mode={props.mode}
            thinking={props.thinking}
            loading={props.loading}
            onSubmit={props.onSubmit}
            onAutocompleteChange={props.onAutocompleteChange}
            fixedHeight={TEXTAREA_HEIGHT}  // 5 rows of textarea content
          />
        </box>
        
        {/* Todo panel - 30% when todos exist */}
        <Show when={hasTodos()}>
          <box 
            width={`${TODO_WIDTH_PERCENT}%`}
            height={PANEL_HEIGHT}
            paddingLeft={1}
            minWidth={0}
            overflow="hidden"
          >
            <TodoPanel height={PANEL_HEIGHT} />
          </box>
        </Show>
      </box>
    </box>
  );
}
