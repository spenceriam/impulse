import { For } from "solid-js";
import { MessageBlock, type Message } from "./MessageBlock";

/**
 * Chat View Component
 * Scrollable message list WITHOUT border or right scrollbar
 * 
 * Layout (v0.13.4 redesign):
 * - No border - uses left gutter for scroll indication instead
 * - No right scrollbar - prevents horizontal push issues
 * - Scrollbox with stickyScroll for auto-scroll to newest content
 * 
 * The gutter component handles scroll indication separately.
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
      minWidth={0}
      width="100%"
      flexDirection="column"
      overflow="hidden"
    >
      <scrollbox 
        flexGrow={1}
        width="100%"
        stickyScroll={true}
        stickyStart="bottom"
        style={{
          viewportOptions: {
            paddingRight: 2,
            paddingLeft: 1,
            paddingTop: 1,
            paddingBottom: 1,
          },
          // No scrollbar - gutter handles scroll indication
          scrollbarOptions: {
            visible: false,
          },
        }}
      >
        <box flexDirection="column" minWidth={0}>
          <For each={messages()}>
            {(message) => <MessageBlock message={message} />}
          </For>
        </box>
      </scrollbox>
    </box>
  );
}
