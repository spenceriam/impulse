import { createSignal, createEffect, onCleanup, For } from "solid-js";
import { Colors } from "../design";

/**
 * Gutter Component
 * Full-height left gutter that serves as visual anchor
 * 
 * Idle: Dim vertical line
 * Processing: Color cycles through GLM-CLI logo palette (200ms per color)
 * 
 * Colors cycle: cyan → purple → blue → orange → white → repeat
 * 
 * Props:
 * - height: Total height in rows
 * - loading: Whether to animate colors
 */

// Gutter width constant - exported for layout calculations
export const GUTTER_WIDTH = 2;

// GLM-CLI logo color palette
const LOGO_COLORS = [
  "#5cffff", // Cyan (primary)
  "#b48eff", // Purple (PLANNER)
  "#5c8fff", // Blue (PLAN-PRD)
  "#ffaa5c", // Orange (DEBUG)
  "#ffffff", // White (AUTO)
];

// Vertical line character
const LINE_CHAR = "│";

interface GutterProps {
  height: number;
  loading: boolean;
}

export function Gutter(props: GutterProps) {
  const [colorIndex, setColorIndex] = createSignal(0);
  let intervalId: ReturnType<typeof setInterval> | undefined;
  
  // Start/stop color cycling based on loading state
  createEffect(() => {
    if (props.loading) {
      // Start cycling at 200ms
      intervalId = setInterval(() => {
        setColorIndex((i) => (i + 1) % LOGO_COLORS.length);
      }, 200);
    } else {
      // Stop cycling
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
      setColorIndex(0); // Reset to first color
    }
  });
  
  onCleanup(() => {
    if (intervalId) {
      clearInterval(intervalId);
    }
  });
  
  const currentColor = (): string => {
    if (props.loading) {
      return LOGO_COLORS[colorIndex()] ?? "#5cffff";
    }
    return Colors.ui.dim;
  };
  
  // Generate array of row indices
  const rows = () => Array.from({ length: props.height }, (_, i) => i);
  
  return (
    <box 
      flexDirection="column" 
      width={GUTTER_WIDTH} 
      flexShrink={0}
      paddingRight={1}
    >
      <For each={rows()}>
        {() => (
          <text fg={currentColor()}>{LINE_CHAR}</text>
        )}
      </For>
    </box>
  );
}
