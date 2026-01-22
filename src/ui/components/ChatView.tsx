import { For } from "solid-js";
import { MessageBlock, type Message } from "./MessageBlock";
import { Colors } from "../design";

/**
 * Chat View Component
 * Bordered container with scrollable message list
 * 
 * Layout (per OpenCode patterns):
 * - Outer box with border, overflow="hidden" to clip content at bounds
 * - Inner scrollbox with flexGrow={1} for remaining space
 * - 2-char inner padding as buffer between content and border (prevents push)
 * - stickyScroll with stickyStart="bottom" for auto-scroll to newest content
 * - Content box has minWidth={0} to prevent text from pushing layout
 * 
 * Key patterns from OpenCode:
 * - overflow="hidden" on bordered containers prevents content breaking out
 * - minWidth={0} on flex children allows shrinking below content size
 * - Inner padding creates visual buffer so content doesn't touch borders
 * 
 * Props:
 * - messages: Array of messages to display
 */

// Inner padding for visual buffer between content and border
const INNER_PADDING = 2;

interface ChatViewProps {
  messages?: Message[];
}

export function ChatView(props: ChatViewProps) {
  const messages = () => props.messages ?? [];

  return (
    <box 
      flexGrow={1}
      minWidth={0}           // Allow shrinking below content width
      width="100%"           // Take full width of parent
      border
      borderColor={Colors.ui.dim}
      flexDirection="column"
      overflow="hidden"      // Clip content at border bounds
    >
      <scrollbox 
        flexGrow={1}
        width="100%"         // Explicit width for scrollbox
        stickyScroll={true}
        stickyStart="bottom"
        style={{
          viewportOptions: {
            // 2-char padding as buffer between content and border
            // This prevents content from pushing against border edges
            paddingRight: INNER_PADDING,
            paddingLeft: INNER_PADDING,
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
        <box flexDirection="column" minWidth={0}>
          <For each={messages()}>
            {(message) => <MessageBlock message={message} />}
          </For>
        </box>
      </scrollbox>
    </box>
  );
}
