import { For, Show, createEffect, on, onCleanup, ErrorBoundary, createSignal } from "solid-js";
import { useAppKeyboard } from "../context/keyboard";
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
  onConfirmUpdate?: () => void;
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
  let scrollTimer: NodeJS.Timeout | null = null;
  const [userScrolledUp, setUserScrolledUp] = createSignal(false);
  
  // Scroll to bottom helper - uses scrollTo for reliable positioning
  const scrollToBottom = () => {
    if (!scrollboxRef) return;
    if (typeof scrollboxRef.scrollToBottom === "function") {
      scrollboxRef.scrollToBottom();
      setUserScrolledUp(false);
      return;
    }
    if (typeof scrollboxRef.scrollTo === "function") {
      scrollboxRef.scrollTo(100_000);
      setUserScrolledUp(false);
      return;
    }
    if ("scrollTop" in scrollboxRef) {
      scrollboxRef.scrollTop = getMaxScrollTop();
      setUserScrolledUp(false);
    }
  };
  
  // Scroll by a relative amount (positive = down, negative = up)
  const scrollBy = (lines: number) => {
    if (scrollboxRef && typeof scrollboxRef.scrollBy === "function") {
      scrollboxRef.scrollBy(lines);
    }
  };

  const scheduleScroll = (delay: number = 16, force: boolean = false) => {
    if (!force && !isLoading() && userScrolledUp()) return;
    if (scrollTimer) return;
    scrollTimer = setTimeout(() => {
      scrollTimer = null;
      if (!force && !isLoading() && userScrolledUp()) return;
      scrollToBottom();
    }, delay);
  };

  const getMaxScrollTop = () => {
    if (!scrollboxRef) return 0;
    const viewportHeight = scrollboxRef.viewport?.height ?? 0;
    return Math.max(0, scrollboxRef.scrollHeight - viewportHeight);
  };
  
  const isAtBottom = () => {
    if (!scrollboxRef) return true;
    const maxScrollTop = getMaxScrollTop();
    return scrollboxRef.scrollTop >= maxScrollTop - 1;
  };
  
  const updateScrollState = () => {
    if (isLoading()) {
      setUserScrolledUp(false);
      return;
    }
    setUserScrolledUp(!isAtBottom());
  };
  
  const scheduleScrollStateUpdate = () => {
    setTimeout(() => {
      updateScrollState();
    }, 0);
  };
  
  // Auto-scroll when messages change (new message added)
  createEffect(on(() => messages().length, () => {
    // Scroll after DOM updates
    scheduleScroll(50);
  }, { defer: true }));
  
  // Auto-scroll during loading - keep pinned to bottom
  createEffect(() => {
    if (isLoading()) {
      // While loading, keep pinned to bottom
      setUserScrolledUp(false);
      scheduleScroll(16, true);
    }
  });

  // Lock auto-scroll while loading: force pin to bottom and track any message updates
  createEffect(() => {
    if (!isLoading()) return;
    // Track all message updates (content, reasoning, tool calls) while loading
    messages();
    scheduleScroll(16, true);
  });

  // Ensure we land at bottom after streaming completes
  createEffect(on(isLoading, (loading, prev) => {
    if (prev && !loading) {
      scheduleScroll(50);
      scheduleScrollStateUpdate();
    }
  }, { defer: true }));
  
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
    scheduleScroll(16);
  });

  onCleanup(() => {
    if (scrollTimer) {
      clearTimeout(scrollTimer);
      scrollTimer = null;
    }
  });
  
  // Keyboard handler for PageUp/PageDown scrolling (only when not loading)
  useAppKeyboard((key) => {
    // Don't handle if AI is processing - stay locked to bottom
    if (isLoading()) return;
    
    if (key.name === "pageup") {
      scrollBy(-PAGE_SCROLL_LINES);
      scheduleScrollStateUpdate();
    } else if (key.name === "pagedown") {
      scrollBy(PAGE_SCROLL_LINES);
      scheduleScrollStateUpdate();
    }
  });

  // Handle Y/N keys for update prompt (when visible in session view)
  useAppKeyboard((key) => {
    // Only handle when update is available
    if (updateState()?.status !== "available") return;
    
    if (key.name === "y" || key.name === "Y") {
      props.onConfirmUpdate?.();
      return;
    }
    
    if (key.name === "n" || key.name === "N") {
      props.onDismissUpdate?.();
      return;
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
      
      case "available":
        return (
          <box 
            flexDirection="row" 
            paddingLeft={1}
            paddingRight={1}
            height={1}
            alignItems="center"
            backgroundColor="#001a1a"
          >
            <text fg={Colors.ui.primary}>Update available: v{state.latestVersion}</text>
            <box flexGrow={1} />
            <box 
              onMouseDown={() => props.onConfirmUpdate?.()}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={Colors.status.success}>[Y] Update</text>
            </box>
            <box 
              onMouseDown={() => props.onDismissUpdate?.()}
              paddingLeft={1}
            >
              <text fg={Colors.ui.dim}>[N] Dismiss</text>
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
        stickyScroll={isLoading() ? true : !userScrolledUp()}
        stickyStart="bottom"
        onMouseScroll={() => {
          if (isLoading()) {
            scheduleScroll(0, true);
            return;
          }
          scheduleScrollStateUpdate();
        }}
        scrollAcceleration={scrollAcceleration}
        style={{
          viewportOptions: {
            paddingRight: 1,
            paddingLeft: 1,
            paddingTop: 1,
            paddingBottom: 1,
          },
          // IMPORTANT:
          // Do not override contentOptions.onSizeChange.
          // OpenTUI's ScrollBox uses that internal hook to recalculate
          // scrollHeight/viewport metrics. Overriding it breaks scrolling.
          scrollbarOptions: {
            visible: false,
          },
        }}
      >
        <box flexDirection="column" minWidth={0} overflow="hidden">
          <For each={messages()}>
            {(message) => (
              <ErrorBoundary fallback={(err: unknown) => (
                <box flexDirection="column" paddingLeft={1} paddingRight={1}>
                  <text fg={Colors.status.error}>Message render failed.</text>
                  <text fg={Colors.ui.dim}>{String(err)}</text>
                </box>
              )}>
                <MessageBlock 
                  message={message} 
                  {...(props.onCopyMessage ? { onCopy: props.onCopyMessage } : {})}
                />
              </ErrorBoundary>
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
