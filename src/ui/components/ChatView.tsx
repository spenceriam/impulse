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
 * - stickyScroll with stickyStart="bottom" for auto-scroll to newest content
 * 
 * Props:
 * - messages: Array of messages to display
 */

interface ChatViewProps {
  messages?: Message[];
}

export function ChatView(props: ChatViewProps) {
  const messages = () => props.messages ?? [];

  return (
    <scrollbox 
      flexGrow={1}
      border
      borderColor={Colors.ui.dim}
      stickyScroll={true}
      stickyStart="bottom"
      viewportOptions={{
        paddingRight: 2,
        paddingLeft: 1,
        paddingTop: 1,
        paddingBottom: 1,
      }}
      verticalScrollbarOptions={{
        visible: true,
        paddingLeft: 1,
        trackOptions: {
          foregroundColor: Colors.mode.AGENT,  // Cyan thumb
          backgroundColor: Colors.ui.dim,       // Dim track
        },
      }}
    >
      <box flexDirection="column" width="100%">
        <For each={messages()}>
          {(message) => <MessageBlock message={message} />}
        </For>
      </box>
    </scrollbox>
  );
}
