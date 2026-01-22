import { Show } from "solid-js";
import { InputArea, type CommandCandidate } from "./InputArea";
import { TodoPanel } from "./TodoPanel";
import { StackedSpinner } from "./Spinner";
import { useTodo } from "../context";
import { type Mode } from "../design";

/**
 * BottomPanel Component
 * Fixed-height bottom section with 70/30 split (prompt/todos)
 * 
 * Layout:
 * - When todos exist: 70% prompt box, 30% todo panel
 * - When no todos: 100% prompt box
 * - Fixed height of 7 rows (5 content + 2 border)
 * 
 * Structure:
 * ┌─────────────────────────────────────────────┬───────────┐
 * │ [Spinner] ┌─ MODE ─────────────────────┐    │┌─ Todo ──┐│
 * │           │ > _                        │    ││ [>] Task││
 * │           │                            │    ││ [ ] Next││
 * │           │                            │    │└─────────┘│
 * │           └────────────────────────────┘    │           │
 * └─────────────────────────────────────────────┴───────────┘
 */

const PANEL_HEIGHT = 7;  // Fixed height: 5 content + 2 border
const PROMPT_WIDTH_PERCENT = 70;
const TODO_WIDTH_PERCENT = 30;

interface BottomPanelProps {
  mode: Mode;
  thinking: boolean;
  loading: boolean;
  hasProcessed: boolean;  // True if AI has ever processed (for spinner idle state)
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
    >
      {/* Spinner column - reserved space to keep layout stable */}
      <box 
        width={3} 
        flexShrink={0} 
        paddingRight={1} 
        height="100%" 
        justifyContent="center"
        alignItems="center"
      >
        <Show when={props.loading}>
          <StackedSpinner height={5} />
        </Show>
        {/* Show static last frame when idle after processing */}
        <Show when={!props.loading && props.hasProcessed}>
          <StackedSpinner height={5} static />
        </Show>
      </box>
      
      {/* Prompt + Todo split */}
      <box flexDirection="row" flexGrow={1}>
        {/* Prompt box - 70% or 100% depending on todos */}
        <box 
          width={hasTodos() ? `${PROMPT_WIDTH_PERCENT}%` : "100%"}
          height={PANEL_HEIGHT}
        >
          <InputArea
            mode={props.mode}
            thinking={props.thinking}
            loading={props.loading}
            onSubmit={props.onSubmit}
            onAutocompleteChange={props.onAutocompleteChange}
            fixedHeight={5}  // 5 rows of content (new prop)
          />
        </box>
        
        {/* Todo panel - 30% when todos exist */}
        <Show when={hasTodos()}>
          <box 
            width={`${TODO_WIDTH_PERCENT}%`}
            height={PANEL_HEIGHT}
            paddingLeft={1}
          >
            <TodoPanel height={PANEL_HEIGHT} />
          </box>
        </Show>
      </box>
    </box>
  );
}
