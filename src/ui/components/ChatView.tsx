import { For } from "solid-js";
import { MessageBlock, type Message } from "./MessageBlock";
import { Colors } from "../design";

/**
 * Chat View Component
 * Bordered container with scrollable message list
 * 
 * Layout:
 * - Outer box with border for visual frame (border separated from scrollbox)
 * - Inner scrollbox for content (no border - avoids scrollbar alignment issues)
 * - stickyScroll with stickyStart="bottom" for auto-scroll to newest content
 * - Scrollbar styled via style prop per OpenTUI patterns
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
    <box 
      flexGrow={1}
      border
      borderColor={Colors.ui.dim}
      flexDirection="column"
    >
      <scrollbox 
        flexGrow={1}
        stickyScroll={true}
        stickyStart="bottom"
        style={{
          viewportOptions: {
            paddingRight: 1,
            paddingLeft: 1,
            paddingTop: 1,
            paddingBottom: 1,
          },
          scrollbarOptions: {
            trackOptions: {
              foregroundColor: Colors.mode.AGENT,  // Cyan thumb
              backgroundColor: Colors.ui.dim,       // Dim track
            },
          },
        }}
      >
        <box flexDirection="column" width="100%">
          <For each={messages()}>
            {(message) => <MessageBlock message={message} />}
          </For>
        </box>
      </scrollbox>
    </box>
  );
}
