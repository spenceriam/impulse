import { For } from "solid-js";
import { MessageBlock, type Message } from "./MessageBlock";
import { Colors } from "../design";

/**
 * Chat View Component
 * Bordered container with scrollable message list
 * 
 * Layout:
 * - Outer box with border for visual frame
 * - Inner scrollbox for content (doesn't disturb border)
 * - Tight padding to preserve screen real estate
 * - Styled scrollbar matching color scheme
 * 
 * Props:
 * - messages: Array of messages to display
 */

interface ChatViewProps {
  messages?: Message[];
}

// Scrollbar styling to match color scheme
const scrollbarStyle = {
  scrollbarOptions: {
    showArrows: false,
    trackOptions: {
      foregroundColor: Colors.mode.AGENT,  // Cyan thumb
      backgroundColor: Colors.ui.dim,       // Dim track
    },
  },
};

export function ChatView(props: ChatViewProps) {
  const messages = () => props.messages ?? [];

  return (
    <box flexGrow={1} border borderColor={Colors.ui.dim}>
      <scrollbox 
        height="100%" 
        focused 
        stickyScroll 
        padding={1}
        style={scrollbarStyle}
      >
        <For each={messages()}>
          {(message) => <MessageBlock message={message} />}
        </For>
      </scrollbox>
    </box>
  );
}
