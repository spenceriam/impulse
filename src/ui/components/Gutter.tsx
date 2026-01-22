import { createSignal, onMount, onCleanup, For } from "solid-js";
import { Colors } from "../design";

/**
 * Gutter Component
 * Unified left gutter that serves dual purpose:
 * 1. Scroll position indicator for ChatView region
 * 2. Spinner animation for InputArea region during processing
 * 
 * Layout:
 * ┌───┬─────────────────────────────────────────────┐
 * │ ▲ │ (more content above)                        │
 * │ █ │ Visible content area                        │
 * │ █ │                                             │
 * │ ░ │                                             │
 * │ ▼ │ (more content below)                        │
 * ├───┼─────────────────────────────────────────────┤
 * │ ⣾ │ ┌─ Input Area ─────────────────────────────┐│
 * │ ⣽ │ │                                          ││
 * │ ⣻ │ │                                          ││
 * │ ⢿ │ └──────────────────────────────────────────┘│
 * └───┴─────────────────────────────────────────────┘
 * 
 * Props:
 * - chatHeight: Height of chat region in rows
 * - inputHeight: Height of input region in rows
 * - scrollPosition: 0-1 value of scroll position
 * - scrollVisible: 0-1 value of visible content ratio
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
  scrollPosition: number;  // 0-1, where in the content we are
  scrollVisible: number;   // 0-1, what fraction of content is visible
  hasMoreAbove: boolean;
  hasMoreBelow: boolean;
  loading: boolean;
  hasProcessed: boolean;
}

export function Gutter(props: GutterProps) {
  // Spinner animation state
  const [frameIndices, setFrameIndices] = createSignal<number[]>([]);
  let intervalIds: ReturnType<typeof setInterval>[] = [];
  
  // Initialize spinner animation
  onMount(() => {
    const spinnerHeight = props.inputHeight;
    
    if (!props.loading && !props.hasProcessed) {
      // No spinner needed yet
      setFrameIndices(Array.from({ length: spinnerHeight }, () => 0));
      return;
    }
    
    if (!props.loading && props.hasProcessed) {
      // Static mode - show last frame
      const lastFrameIndex = DNA_HELIX_FRAMES.length - 1;
      setFrameIndices(Array.from({ length: spinnerHeight }, () => lastFrameIndex));
      return;
    }
    
    // Animated mode
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
  });
  
  onCleanup(() => {
    intervalIds.forEach((id) => clearInterval(id));
    intervalIds = [];
  });
  
  // Calculate scroll indicator rows
  const getScrollRows = () => {
    const height = props.chatHeight;
    const rows: { char: string; color: string }[] = [];
    
    // If no scrolling needed (all content visible), show simple line
    if (props.scrollVisible >= 1) {
      for (let i = 0; i < height; i++) {
        rows.push({ char: SCROLL_CHARS.line, color: Colors.ui.dim });
      }
      return rows;
    }
    
    // Calculate thumb position and size
    const thumbSize = Math.max(1, Math.floor(height * props.scrollVisible));
    const thumbStart = Math.floor((height - thumbSize) * props.scrollPosition);
    
    for (let i = 0; i < height; i++) {
      if (i === 0 && props.hasMoreAbove) {
        rows.push({ char: SCROLL_CHARS.arrowUp, color: Colors.ui.dim });
      } else if (i === height - 1 && props.hasMoreBelow) {
        rows.push({ char: SCROLL_CHARS.arrowDown, color: Colors.ui.dim });
      } else if (i >= thumbStart && i < thumbStart + thumbSize) {
        rows.push({ char: SCROLL_CHARS.filled, color: Colors.mode.AGENT });
      } else {
        rows.push({ char: SCROLL_CHARS.empty, color: Colors.ui.dim });
      }
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
