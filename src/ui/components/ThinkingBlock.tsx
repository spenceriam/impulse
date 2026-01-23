import { createSignal, Show } from "solid-js";
import { Colors, Indicators } from "../design";

/**
 * Thinking Block Component
 * Collapsible thinking display with 2-row preview
 * 
 * States:
 * - Collapsed (default): 2-row scrollable preview, auto-scrolls to show latest
 * - Expanded: 8-row scrollable view, click to collapse
 * 
 * Layout (Collapsed):
 * ▶ Thinking (click to expand)
 * ┃ I need to analyze the user's request carefully. First, I
 * ┃ should understand what they're asking for and then...
 * 
 * Layout (Expanded):
 * ▼ Thinking (click to collapse)
 * ┃ I need to analyze the user's request carefully. First, I
 * ┃ should understand what they're asking for and then plan
 * ┃ my approach. Let me break this down:
 * ┃
 * ┃ 1. The user wants to fix the UI layout
 * ┃ 2. There are issues with border alignment
 * ┃ 3. The thinking section should be collapsible
 * ┃
 * 
 * Design: No border, just darker background color for differentiation
 * 
 * Props:
 * - content: Thinking content to display
 * - streaming: Whether content is currently being streamed (auto-scroll when true)
 */

// Height constants
const COLLAPSED_HEIGHT = 2;  // 2-row preview when collapsed
const EXPANDED_HEIGHT = 8;   // 8-row view when expanded

interface ThinkingBlockProps {
  content?: string;
  streaming?: boolean;
}

export function ThinkingBlock(props: ThinkingBlockProps) {
  // Default to collapsed state
  const [expanded, setExpanded] = createSignal(false);

  const showContent = () => !!props.content && props.content.trim().length > 0;

  const handleToggle = () => {
    setExpanded((e) => !e);
  };

  const indicator = () => expanded() ? Indicators.expanded : Indicators.collapsed;
  const label = () => expanded() ? "Thinking (click to collapse)" : "Thinking (click to expand)";
  const height = () => expanded() ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;

  return (
    <Show when={showContent()}>
      <box 
        flexDirection="column" 
        marginTop={1}
        marginBottom={1}
        backgroundColor={Colors.message.thinking}
        width="100%"
        overflow="hidden"
        flexShrink={0}
      >
        {/* Header - clickable to toggle */}
        <box
          flexDirection="row"
          paddingLeft={1}
          paddingRight={1}
          // @ts-ignore: OpenTUI onMouseDown handler
          onMouseDown={handleToggle}
          flexShrink={0}
        >
          <text fg={Colors.ui.dim}>
            {indicator()} {label()}
          </text>
        </box>
        
        {/* Content area - scrollable with left border accent */}
        <box flexDirection="row" paddingLeft={1}>
          <box flexShrink={0} width={2}>
            <text fg={Colors.ui.dim}>┃ </text>
          </box>
          <scrollbox
            height={height()}
            flexGrow={1}
            stickyScroll={(props.streaming ?? false) && !expanded()}  // Auto-scroll in collapsed+streaming mode
            stickyStart="bottom"
            style={{
              viewportOptions: {
                paddingRight: 1,
              },
            }}
          >
            <text fg={Colors.ui.dim}><em>{props.content}</em></text>
          </scrollbox>
        </box>
      </box>
    </Show>
  );
}
