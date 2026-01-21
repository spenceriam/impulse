import { For } from "solid-js";
import { MessageBlock, type Message } from "./MessageBlock";

/**
 * Chat View Component
 * Scrollable message list with auto-scroll support
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
    <scrollbox height="100%" focused stickyScroll>
      <For each={messages()}>
        {(message) => <MessageBlock message={message} />}
      </For>
    </scrollbox>
  );
}
