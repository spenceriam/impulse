import { InputArea, type CommandCandidate } from "./InputArea";
import { QueueBar, getQueueBarHeight } from "./QueueBar";
import { useQueue } from "../context/queue";
import { type Mode } from "../design";

/**
 * BottomPanel Component
 * Vertical stack: optional queue preview ABOVE prompt
 * 
 * Layout (v0.24.0 update):
 * - Queue preview (if any): stacked above input, no border
 * 
 * Height Calculation for InputArea (borderless design):
 * - top accent line: 1 row
 * - mode label row: 1 row
 * - empty row above prompt: 1 row
 * - textarea content: 5 rows
 * - empty row below prompt: 1 row
 * - bottom accent line: 1 row
 * - Total: 1 + 1 + 1 + 5 + 1 + 1 = 10 rows
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

// Height calculation: accent(1) + header(1) + padding(2) + textarea(5) + accent(1) = 10
const TEXTAREA_HEIGHT = 5;
const ACCENT_HEIGHT = 2;  // Top + bottom accent lines
const HEADER_HEIGHT = 1;  // Mode label row
const PADDING_HEIGHT = 2; // Empty rows above and below prompt
const INPUT_HEIGHT = TEXTAREA_HEIGHT + ACCENT_HEIGHT + HEADER_HEIGHT + PADDING_HEIGHT;  // 10 rows

// Export panel height for Gutter calculations (dynamic based on todos)
export const BOTTOM_PANEL_HEIGHT = INPUT_HEIGHT;  // Base height without todos

interface BottomPanelProps {
  mode: Mode;
  model: string;  // Current model name
  thinking: boolean;
  loading: boolean;
  overlayActive?: boolean;  // When true, unfocus input (overlay is showing)
  copiedIndicator?: boolean;  // Show "Copied" indicator
  onSubmit: (value: string) => void;
  onAutocompleteChange: (data: { commands: CommandCandidate[]; selectedIndex: number } | null) => void;
  onCopy?: (text: string) => void;  // Called when user copies prompt text via Shift+Ctrl+C
}

export function BottomPanel(props: BottomPanelProps) {
  const queue = useQueue();
  
  const panelHeight = () => {
    const queueHeight = getQueueBarHeight(queue.count());
    return INPUT_HEIGHT + queueHeight;
  };

  return (
    <box 
      flexDirection="column"  // Vertical stack: todo panel above input
      height={panelHeight()}
      width="100%"
      minWidth={0}
      overflow="hidden"
    >
      {/* Queue preview - stacked queued messages above input */}
      <QueueBar />
      
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
          copiedIndicator={props.copiedIndicator ?? false}
          onSubmit={props.onSubmit}
          onAutocompleteChange={props.onAutocompleteChange}
          onCopy={props.onCopy}
          fixedHeight={TEXTAREA_HEIGHT}  // 5 rows of textarea content
        />
      </box>
    </box>
  );
}
