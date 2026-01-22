import { For } from "solid-js";
import { MessageBlock, type Message } from "./MessageBlock";
import { Colors } from "../design";

/**
 * Chat View Component
 * Bordered container with scrollable message list
 * 
 * Layout (per OpenCode patterns):
 * - Outer box with border, overflow="hidden" to clip content at bounds
 * - Inner scrollbox with flexGrow={1} and minWidth={0} to allow shrinking
 * - stickyScroll with stickyStart="bottom" for auto-scroll to newest content
 * - Content box has minWidth={0} to prevent text from pushing layout
 * 
 * Key patterns from OpenCode:
 * - overflow="hidden" on bordered containers prevents content breaking out
 * - minWidth={0} on flex children allows shrinking below content size
 * - width="100%" with container constraints for text wrapping
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
      minWidth={0}           // Allow shrinking below content width
      border
      borderColor={Colors.ui.dim}
      flexDirection="column"
      overflow="hidden"      // Clip content at border bounds
    >
      <scrollbox 
        flexGrow={1}
        minWidth={0}         // Allow scrollbox to shrink
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
        <box flexDirection="column" width="100%" minWidth={0}>
          <For each={messages()}>
            {(message) => <MessageBlock message={message} />}
          </For>
        </box>
      </scrollbox>
    </box>
  );
}
