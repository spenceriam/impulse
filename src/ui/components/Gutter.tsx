import { createSignal, createEffect, onCleanup, For } from "solid-js";
import { Colors } from "../design";

/**
 * Gutter Component
 * Unified left gutter that serves dual purpose:
 * 1. Visual anchor line for ChatView region
 * 2. Spinner animation for InputArea region during processing
 * 
 * Layout:
 * ┌───┬─────────────────────────────────────────────┐
 * │ │ │ Chat content area                           │
 * │ │ │                                             │
 * │ │ │                                             │
 * ├───┼─────────────────────────────────────────────┤
 * │ ⣾ │ ┌─ Input Area ─────────────────────────────┐│
 * │ ⣽ │ │                                          ││
 * │ ⣻ │ │                                          ││
 * │ ⢿ │ └──────────────────────────────────────────┘│
 * └───┴─────────────────────────────────────────────┘
 * 
 * Note: OpenTUI scrollbox doesn't expose scroll events, so the chat region
 * just shows a dim vertical line. The scrollbox handles scrolling internally.
 * 
 * Props:
 * - chatHeight: Height of chat region in rows
 * - inputHeight: Height of input region in rows
 * - loading: Whether spinner should animate
 * - hasProcessed: Whether to show static spinner (idle after processing)
 */

// Gutter width constant - exported for layout calculations
export const GUTTER_WIDTH = 3;

// DNA Helix animation frames
const DNA_HELIX_FRAMES = [
  "⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷",
];

// Gradient colors for spinner
const GRADIENT_COLORS = [
  "#5cffff", "#4ad4d4", "#38a9a9", "#267e7e", "#1a6666", "#666666",
];

// Scroll indicator characters
const SCROLL_CHARS = {
  filled: "█",
  empty: "░",
  arrowUp: "▲",
  arrowDown: "▼",
  line: "│",
};

interface GutterProps {
  chatHeight: number;
  inputHeight: number;
  loading: boolean;
  hasProcessed: boolean;
  // Note: scroll position props removed - OpenTUI scrollbox doesn't expose scroll events
  // Future: could add scroll tracking if OpenTUI adds support
}

export function Gutter(props: GutterProps) {
  // Spinner animation state
  const [frameIndices, setFrameIndices] = createSignal<number[]>([]);
  let intervalIds: ReturnType<typeof setInterval>[] = [];
  
  // Helper to clear all intervals
  const clearAllIntervals = () => {
    intervalIds.forEach((id) => clearInterval(id));
    intervalIds = [];
  };
  
  // Helper to start animation
  const startAnimation = () => {
    clearAllIntervals();
    const spinnerHeight = props.inputHeight;
    
    // Animated mode - set random initial positions and start intervals
    const initial = Array.from({ length: spinnerHeight }, () => 
      Math.floor(Math.random() * DNA_HELIX_FRAMES.length)
    );
    setFrameIndices(initial);
    
    for (let i = 0; i < spinnerHeight; i++) {
      const rowInterval = 100 + (Math.random() * 40 - 20);
      const id = setInterval(() => {
        setFrameIndices((indices) => {
          const newIndices = [...indices];
          newIndices[i] = ((newIndices[i] ?? 0) + 1) % DNA_HELIX_FRAMES.length;
          return newIndices;
        });
      }, rowInterval);
      intervalIds.push(id);
    }
  };
  
  // Helper to stop animation and show static state
  const stopAnimation = (showStatic: boolean) => {
    clearAllIntervals();
    const spinnerHeight = props.inputHeight;
    
    if (showStatic) {
      // Static mode - show last frame
      const lastFrameIndex = DNA_HELIX_FRAMES.length - 1;
      setFrameIndices(Array.from({ length: spinnerHeight }, () => lastFrameIndex));
    } else {
      // Not processed yet - blank
      setFrameIndices(Array.from({ length: spinnerHeight }, () => 0));
    }
  };
  
  // React to loading changes
  createEffect(() => {
    const loading = props.loading;
    const hasProcessed = props.hasProcessed;
    
    if (loading) {
      startAnimation();
    } else {
      stopAnimation(hasProcessed);
    }
  });
  
  onCleanup(() => {
    clearAllIntervals();
  });
  
  // Calculate scroll indicator rows
  // Note: OpenTUI scrollbox doesn't expose scroll position events,
  // so we show a simple vertical line. The scrollbox handles scrolling internally.
  const getScrollRows = () => {
    const height = props.chatHeight;
    const rows: { char: string; color: string }[] = [];
    
    // Show a dim vertical line - visual anchor for the gutter
    for (let i = 0; i < height; i++) {
      rows.push({ char: SCROLL_CHARS.line, color: Colors.ui.dim });
    }
    
    return rows;
  };
  
  // Get spinner row
  const getSpinnerColor = (index: number): string => {
    if (!props.loading && props.hasProcessed) {
      return Colors.ui.dim;
    }
    if (!props.loading && !props.hasProcessed) {
      return "transparent";
    }
    const colorIndex = Math.floor((index / props.inputHeight) * GRADIENT_COLORS.length);
    return GRADIENT_COLORS[Math.min(colorIndex, GRADIENT_COLORS.length - 1)] || "#5cffff";
  };
  
  const getSpinnerFrame = (index: number): string => {
    if (!props.loading && !props.hasProcessed) {
      return " ";
    }
    const indices = frameIndices();
    const frameIdx = indices[index] ?? 0;
    return DNA_HELIX_FRAMES[frameIdx] ?? "⣾";
  };
  
  return (
    <box 
      flexDirection="column" 
      width={GUTTER_WIDTH} 
      flexShrink={0}
      paddingRight={1}
    >
      {/* Scroll indicator region (ChatView height) */}
      <box flexDirection="column" height={props.chatHeight} flexShrink={0}>
        <For each={getScrollRows()}>
          {(row) => (
            <text fg={row.color}>{row.char}</text>
          )}
        </For>
      </box>
      
      {/* Spinner region (InputArea height) */}
      <box flexDirection="column" height={props.inputHeight} flexShrink={0}>
        <For each={Array.from({ length: props.inputHeight }, (_, i) => i)}>
          {(index) => (
            <text fg={getSpinnerColor(index)}>{getSpinnerFrame(index)}</text>
          )}
        </For>
      </box>
    </box>
  );
}
