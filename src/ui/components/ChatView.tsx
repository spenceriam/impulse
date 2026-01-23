import { For, Show } from "solid-js";
import { MessageBlock, type Message } from "./MessageBlock";
import { CompactingBlock } from "./CompactingBlock";

/**
 * Compacting state for display in chat
 */
export interface CompactingState {
  status: "compacting" | "complete";
  removedCount?: number;
}

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
 * - compactingState: Optional compacting indicator to show at end of messages
 */

interface ChatViewProps {
  messages?: Message[];
  compactingState?: CompactingState | null;
}

export function ChatView(props: ChatViewProps) {
  const messages = () => props.messages ?? [];
  const compactingState = () => props.compactingState ?? null;

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
          {/* Show compacting indicator when active */}
          <Show when={compactingState()}>
            {(state: () => CompactingState) => {
              const s = state();
              return (
                <CompactingBlock 
                  status={s.status} 
                  {...(s.removedCount !== undefined ? { removedCount: s.removedCount } : {})}
                />
              );
            }}
          </Show>
        </box>
      </scrollbox>
    </box>
  );
}
