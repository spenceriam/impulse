import { For, Show, createEffect, on } from "solid-js";
import { MessageBlock, type Message } from "./MessageBlock";
import { CompactingBlock } from "./CompactingBlock";
import { UpdateState } from "../../util/update-check";
import { Colors } from "../design";

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
 * - Update notification anchored at BOTTOM (above prompt), dismissable with X
 * 
 * Props:
 * - messages: Array of messages to display
 * - compactingState: Optional compacting indicator to show at end of messages
 * - updateState: Optional update state to show at bottom (above prompt)
 * - onDismissUpdate: Callback when user dismisses update notification
 */

interface ChatViewProps {
  messages?: Message[];
  compactingState?: CompactingState | null;
  updateState?: UpdateState | null;
  onDismissUpdate?: () => void;
}

export function ChatView(props: ChatViewProps) {
  const messages = () => props.messages ?? [];
  const compactingState = () => props.compactingState ?? null;
  const updateState = () => props.updateState ?? null;
  
  // Ref to scrollbox for programmatic scrolling
  // Using 'any' because ScrollBoxRenderable type may not expose scrollToBottom
  let scrollboxRef: any;
  
  // Auto-scroll to bottom when messages change
  // This ensures the latest content is visible even if user has scrolled up
  createEffect(on(messages, () => {
    // Small delay to let the DOM update first
    setTimeout(() => {
      if (scrollboxRef && typeof scrollboxRef.scrollToBottom === "function") {
        scrollboxRef.scrollToBottom();
      }
    }, 16); // One frame
  }, { defer: true }));

  // Render update notification based on state
  const renderUpdateNotification = () => {
    const state = updateState();
    if (!state) return null;

    switch (state.status) {
      case "installing":
        return (
          <box 
            flexDirection="row" 
            paddingLeft={1}
            paddingRight={1}
            height={1}
            alignItems="center"
            backgroundColor="#1a1a00"
          >
            <text fg={Colors.status.warning}>Updating to {state.latestVersion}...</text>
          </box>
        );
      
      case "installed":
        return (
          <box 
            flexDirection="row" 
            paddingLeft={1}
            paddingRight={1}
            height={1}
            alignItems="center"
            backgroundColor="#001a00"
          >
            <text fg={Colors.status.success}>Updated to {state.latestVersion}! Please restart IMPULSE to apply.</text>
            <box flexGrow={1} />
            <box onMouseDown={() => props.onDismissUpdate?.()}>
              <text fg={Colors.ui.dim}>[X]</text>
            </box>
          </box>
        );
      
      case "failed":
        return (
          <box 
            flexDirection="row" 
            paddingLeft={1}
            paddingRight={1}
            height={1}
            alignItems="center"
            backgroundColor="#1a0000"
          >
            <text fg={Colors.status.error}>Update failed. Run: </text>
            <text fg={Colors.ui.primary}>{state.updateCommand}</text>
            <box flexGrow={1} />
            <box onMouseDown={() => props.onDismissUpdate?.()}>
              <text fg={Colors.ui.dim}>[X]</text>
            </box>
          </box>
        );
      
      default:
        return null;
    }
  };

  return (
    <box 
      flexGrow={1}
      minWidth={0}
      flexDirection="column"
      overflow="hidden"
    >
      {/* Scrollable message area */}
      <scrollbox 
        ref={(r: any) => { scrollboxRef = r; }}
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
      
      {/* Update notification - anchored at BOTTOM of chat, above prompt */}
      {renderUpdateNotification()}
    </box>
  );
}
