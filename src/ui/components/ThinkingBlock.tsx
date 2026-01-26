import { createSignal, createMemo, createEffect, Show, on } from "solid-js";
import { Colors, type Mode, getModeBackground } from "../design";

/**
 * Thinking Block Component
 * Collapsible thinking display with 5-row preview
 * 
 * States:
 * - Collapsed (default): 5-row preview with auto-scroll during streaming
 * - Expanded: Full content (max 20 rows), manual scroll
 * 
 * Behavior:
 * - Auto-collapses when streaming ends (turn complete)
 * - User can expand/collapse manually at any time
 * 
 * Icons:
 * - ● (filled dot) = collapsed (shows preview)
 * - ○ (hollow dot) = expanded (shows full)
 * 
 * Props:
 * - content: Thinking content to display
 * - streaming: Whether content is currently being streamed
 */

// Height constants
const PREVIEW_HEIGHT = 5;      // 5-row preview when collapsed

/**
 * Darken a hex color by reducing its brightness
 * Used to create thinking block background that's darker than mode background
 */
function darkenColor(hex: string, factor: number = 0.6): string {
  // Remove # if present
  const color = hex.replace("#", "");
  
  // Parse RGB components
  const r = parseInt(color.substring(0, 2), 16);
  const g = parseInt(color.substring(2, 4), 16);
  const b = parseInt(color.substring(4, 6), 16);
  
  // Darken each component
  const dr = Math.round(r * factor);
  const dg = Math.round(g * factor);
  const db = Math.round(b * factor);
  
  // Convert back to hex
  return `#${dr.toString(16).padStart(2, "0")}${dg.toString(16).padStart(2, "0")}${db.toString(16).padStart(2, "0")}`;
}

interface ThinkingBlockProps {
  content?: string;
  streaming?: boolean;
  mode?: Mode | undefined;
}

export function ThinkingBlock(props: ThinkingBlockProps) {
  const [expanded, setExpanded] = createSignal(false);
  
  // Auto-collapse when streaming ends (turn complete)
  // This ensures thinking is minimized for completed messages
  createEffect(on(
    () => props.streaming,
    (streaming, prevStreaming) => {
      // Only collapse when transitioning from streaming to not streaming
      if (prevStreaming === true && streaming === false) {
        setExpanded(false);
      }
    }
  ));

  const showContent = () => !!props.content && props.content.trim().length > 0;

  const handleToggle = () => {
    setExpanded((e) => !e);
  };

  // Calculate content height based on actual line count
  const contentLines = createMemo(() => {
    if (!props.content) return 0;
    return props.content.split("\n").length;
  });

  // Height depends on state:
  // - Collapsed: min(contentLines, PREVIEW_HEIGHT) - shows up to 5 rows
  // - Expanded: full content height (no max)
  const contentHeight = createMemo(() => {
    const lines = contentLines();
    if (expanded()) {
      return lines; // Full height when expanded
    }
    return Math.min(lines, PREVIEW_HEIGHT);
  });

  // Only show expand/collapse if content exceeds preview height
  const canExpand = () => contentLines() > PREVIEW_HEIGHT;
  
  const indicator = () => expanded() ? "○" : "●";
  const label = () => {
    if (!canExpand()) {
      return "Thinking";  // No expand option if fits in preview
    }
    return expanded() ? "Thinking (click to collapse)" : "Thinking (click to expand)";
  };

  // Auto-scroll when collapsed and streaming
  const shouldAutoScroll = () => !expanded() && (props.streaming ?? false);

  return (
    <Show when={showContent()}>
      <box 
        flexDirection="column" 
        marginTop={1}
        marginBottom={1}
        backgroundColor={props.mode ? darkenColor(getModeBackground(props.mode), 0.7) : Colors.message.thinking}
        overflow="hidden"
        flexShrink={0}
      >
        {/* Header - clickable to toggle only if expandable */}
        <Show
          when={canExpand()}
          fallback={
            <box flexDirection="row" paddingLeft={1} paddingRight={1} flexShrink={0}>
              <text fg={Colors.ui.dim}>● {label()}</text>
            </box>
          }
        >
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
        </Show>
        
        {/* Content area - always shown (preview or full) */}
        <box flexDirection="row" paddingLeft={1}>
          <box flexShrink={0} width={2}>
            <text fg={Colors.ui.dim}>  </text>
          </box>
          <scrollbox
            height={contentHeight()}
            flexGrow={1}
            stickyScroll={shouldAutoScroll()}
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
