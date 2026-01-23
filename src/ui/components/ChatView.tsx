import { For } from "solid-js";
import { MessageBlock, type Message } from "./MessageBlock";

/**
 * Chat View Component
 * Scrollable message list WITHOUT border or right scrollbar
 * 
 * Layout (v0.13.8 redesign):
 * - No border - uses left gutter for visual anchor
 * - No right scrollbar - prevents horizontal push issues
 * - Scrollbox with stickyScroll for auto-scroll to newest content
 * - All content constrained within bounds (no overflow)
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
      flexDirection="column"
      overflow="hidden"
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
            visible: false,
          },
        }}
      >
        <box flexDirection="column" minWidth={0} overflow="hidden">
          <For each={messages()}>
            {(message) => <MessageBlock message={message} />}
          </For>
        </box>
      </scrollbox>
    </box>
  );
}
