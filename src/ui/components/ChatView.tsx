import { For, Show, createEffect, on } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { ScrollAcceleration } from "@opentui/core";
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

// Scroll speed for PageUp/PageDown (lines per keypress)
const PAGE_SCROLL_LINES = 20;

// Mouse wheel scroll speed (lines per scroll tick)
// Default is typically 1, we use 5 for faster scrolling
const MOUSE_SCROLL_SPEED = 5;

/**
 * Custom scroll acceleration for faster mouse wheel scrolling
 * Implements OpenTUI's ScrollAcceleration interface
 */
class FastScrollAcceleration implements ScrollAcceleration {
  private speed: number;
  
  constructor(speed: number = MOUSE_SCROLL_SPEED) {
    this.speed = speed;
  }
  
  tick(_now?: number): number {
    return this.speed;
  }
  
  reset(): void {
    // No acceleration state to reset
  }
}

// Singleton instance for scroll acceleration
const scrollAcceleration = new FastScrollAcceleration(MOUSE_SCROLL_SPEED);

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
 * Auto-scroll behavior:
 * - When isLoading=true: Always pinned to bottom (user can't scroll up)
 * - When isLoading=false: Free scrolling with PageUp/PageDown support
 * - Uses scrollTo(scrollHeight) for reliable positioning
 * 
 * Props:
 * - messages: Array of messages to display
 * - isLoading: Whether AI is currently processing (locks scroll to bottom)
 * - compactingState: Optional compacting indicator to show at end of messages
 * - updateState: Optional update state to show at bottom (above prompt)
 * - onDismissUpdate: Callback when user dismisses update notification
 */

interface ChatViewProps {
  messages?: Message[];
  isLoading?: boolean;
  compactingState?: CompactingState | null;
  updateState?: UpdateState | null;
  onDismissUpdate?: () => void;
  onCopyMessage?: (content: string) => void;  // Called when user clicks a message to copy
}

export function ChatView(props: ChatViewProps) {
  const messages = () => props.messages ?? [];
  const isLoading = () => props.isLoading ?? false;
  const compactingState = () => props.compactingState ?? null;
  const updateState = () => props.updateState ?? null;
  
  // Ref to scrollbox for programmatic scrolling
  // Using 'any' because ScrollBoxRenderable type may not expose scrollToBottom
  let scrollboxRef: any;
  
  // Scroll to bottom helper - uses scrollTo for reliable positioning
  const scrollToBottom = () => {
    if (scrollboxRef) {
      // Use scrollTo with a large number to ensure we reach the bottom
      // This is more reliable than scrollToBottom() which may have timing issues
      if (typeof scrollboxRef.scrollTo === "function") {
        scrollboxRef.scrollTo(100_000);
      } else if (typeof scrollboxRef.scrollToBottom === "function") {
        scrollboxRef.scrollToBottom();
      }
    }
  };
  
  // Scroll by a relative amount (positive = down, negative = up)
  const scrollBy = (lines: number) => {
    if (scrollboxRef && typeof scrollboxRef.scrollBy === "function") {
      scrollboxRef.scrollBy(lines);
    }
  };
  
  // Auto-scroll when messages change (new message added)
  createEffect(on(() => messages().length, () => {
    // Scroll after DOM updates
    setTimeout(scrollToBottom, 50);
  }, { defer: true }));
  
  // Auto-scroll during loading - keep pinned to bottom
  createEffect(() => {
    if (isLoading()) {
      // While loading, continuously scroll to bottom
      setTimeout(scrollToBottom, 16);
    }
  });
  
  // Auto-scroll during streaming - create a derived signal that changes when content updates
  // This triggers reactive tracking on the last message's content
  createEffect(() => {
    const msgs = messages();
    if (msgs.length === 0) return;
    
    const last = msgs[msgs.length - 1];
    if (!last?.streaming) return;
    
    // Access reactive properties to trigger effect when they change
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    last.content;
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions  
    last.reasoning;
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    last.toolCalls;
    
    // Scroll when streaming content changes
    setTimeout(scrollToBottom, 16);
  });
  
  // Keyboard handler for PageUp/PageDown scrolling (only when not loading)
  useKeyboard((key) => {
    // Don't handle if AI is processing - stay locked to bottom
    if (isLoading()) return;
    
    if (key.name === "pageup") {
      scrollBy(-PAGE_SCROLL_LINES);
    } else if (key.name === "pagedown") {
      scrollBy(PAGE_SCROLL_LINES);
    }
  });

  // Render update notification based on state
  const renderUpdateNotification = () => {
    const state = updateState();
    if (!state) return null;

    switch (state.status) {
      case "checking":
        return (
          <box 
            flexDirection="row" 
            paddingLeft={1}
            paddingRight={1}
            height={1}
            alignItems="center"
            backgroundColor="#0d0d1a"
          >
            <text fg={Colors.ui.dim}>Checking for updates...</text>
          </box>
        );
      
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
        // Show error reason if available, otherwise show manual command
        const errorMsg = state.error || "Unknown error";
        const isPermissionError = errorMsg.toLowerCase().includes("permission") || errorMsg.includes("EACCES");
        return (
          <box 
            flexDirection="column" 
            paddingLeft={1}
            paddingRight={1}
            backgroundColor="#1a0000"
          >
            <box flexDirection="row" height={1} alignItems="center">
              <text fg={Colors.status.error}>Update failed: </text>
              <text fg={Colors.ui.text}>{errorMsg.slice(0, 60)}{errorMsg.length > 60 ? "..." : ""}</text>
              <box flexGrow={1} />
              <box onMouseDown={() => props.onDismissUpdate?.()}>
                <text fg={Colors.ui.dim}>[X]</text>
              </box>
            </box>
            <box flexDirection="row" height={1}>
              <text fg={Colors.ui.dim}>
                {isPermissionError ? "Try: " : "Manual: "}
              </text>
              <text fg={Colors.ui.primary}>{state.updateCommand}</text>
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
        scrollAcceleration={scrollAcceleration}
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
            {(message) => (
              <MessageBlock 
                message={message} 
                {...(props.onCopyMessage ? { onCopy: props.onCopyMessage } : {})}
              />
            )}
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
