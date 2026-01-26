import { Colors } from "../design";

/**
 * Gutter Component
 * Full-height left gutter that serves as visual anchor
 * 
 * Always shows a dim vertical line (no animation - spinner moved to status line)
 * 
 * Uses flexGrow to fill available height naturally (from header to above status line)
 */

// Gutter width constant - exported for layout calculations
export const GUTTER_WIDTH = 2;

// Vertical line character - using box-drawing for clean look
const LINE_CHAR = "│";

export function Gutter() {
  // Use a tall repeated string that will be clipped by the container
  // This avoids needing to calculate exact row count
  const lineContent = (LINE_CHAR + "\n").repeat(100);
  
  return (
    <box 
      flexDirection="column" 
      width={GUTTER_WIDTH} 
      flexShrink={0}
      flexGrow={1}
      paddingRight={1}
      overflow="hidden"
    >
      <text fg={Colors.ui.dim}>{lineContent}</text>
    </box>
  );
}
