import { For } from "solid-js";
import { Colors } from "../design";
import { useSidebar } from "../context";

/**
 * Collapsed Sidebar Component
 * A 1-character wide strip with vertical "GLM-CLI" text
 * Click to expand the sidebar
 */

// Vertical text for the strip
const VERTICAL_TEXT = ["G", "L", "M", "-", "C", "L", "I"];

export function CollapsedSidebar() {
  const { show } = useSidebar();

  return (
    <box
      width={1}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      backgroundColor="#1a1a1a"
      onMouseDown={() => show()}
    >
      {/* Fill character at top */}
      <box flexGrow={1}>
        <text fg={Colors.ui.dim}></text>
      </box>
      
      {/* Vertical GLM-CLI text */}
      <For each={VERTICAL_TEXT}>
        {(char) => (
          <text fg={Colors.ui.dim}>{char}</text>
        )}
      </For>
      
      {/* Fill character at bottom */}
      <box flexGrow={1}>
        <text fg={Colors.ui.dim}></text>
      </box>
    </box>
  );
}
