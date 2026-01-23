import { createSignal, createEffect, onCleanup } from "solid-js";
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
 * Uses flexGrow to fill available height naturally (from header to above status line)
 * 
 * Props:
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

// Vertical line character - using box-drawing for clean look
const LINE_CHAR = "│";

interface GutterProps {
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
  
  // Use a tall repeated string that will be clipped by the container
  // This avoids needing to calculate exact row count
  const lineContent = () => (LINE_CHAR + "\n").repeat(100);
  
  return (
    <box 
      flexDirection="column" 
      width={GUTTER_WIDTH} 
      flexShrink={0}
      flexGrow={1}
      paddingRight={1}
      overflow="hidden"
    >
      <text fg={currentColor()}>{lineContent()}</text>
    </box>
  );
}
