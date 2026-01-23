import { createSignal, createMemo, Show } from "solid-js";
import { Colors } from "../design";

/**
 * Thinking Block Component
 * Collapsible thinking display that scales to content
 * 
 * States:
 * - Collapsed (default): Shows "● Thinking" header only, click to expand
 * - Expanded: Shows full content scaled to actual height (max 20 rows), click to collapse
 * 
 * Icons:
 * - ● (filled dot) = collapsed
 * - ○ (hollow dot) = expanded
 * 
 * Props:
 * - content: Thinking content to display
 * - streaming: Whether content is currently being streamed
 */

// Maximum height when expanded (to prevent huge blocks)
const MAX_EXPANDED_HEIGHT = 20;

interface ThinkingBlockProps {
  content?: string;
  streaming?: boolean;
}

export function ThinkingBlock(props: ThinkingBlockProps) {
  const [expanded, setExpanded] = createSignal(false);

  const showContent = () => !!props.content && props.content.trim().length > 0;

  const handleToggle = () => {
    setExpanded((e) => !e);
  };

  // Calculate content height based on actual line count
  const contentLines = createMemo(() => {
    if (!props.content) return 0;
    return props.content.split("\n").length;
  });

  // Height scales to content when expanded, capped at MAX_EXPANDED_HEIGHT
  const contentHeight = createMemo(() => {
    if (!expanded()) return 0; // Collapsed shows no content
    return Math.min(contentLines(), MAX_EXPANDED_HEIGHT);
  });

  const indicator = () => expanded() ? "○" : "●";
  const label = () => expanded() ? "Thinking (click to collapse)" : "Thinking (click to expand)";

  return (
    <Show when={showContent()}>
      <box 
        flexDirection="column" 
        marginTop={1}
        marginBottom={1}
        backgroundColor={Colors.message.thinking}
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
        
        {/* Content area - only shown when expanded */}
        <Show when={expanded()}>
          <box flexDirection="row" paddingLeft={1}>
            <box flexShrink={0} width={2}>
              <text fg={Colors.ui.dim}>  </text>
            </box>
            <scrollbox
              height={contentHeight()}
              flexGrow={1}
              stickyScroll={false}
              style={{
                viewportOptions: {
                  paddingRight: 1,
                },
              }}
            >
              <text fg={Colors.ui.dim}><em>{props.content}</em></text>
            </scrollbox>
          </box>
        </Show>
      </box>
    </Show>
  );
}
