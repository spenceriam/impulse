import { createSignal, Show, For, createEffect } from "solid-js";
import { useAppKeyboard } from "../context/keyboard";
import { Colors } from "../design";
import { useQueue, type QueuedMessage } from "../context/queue";

/**
 * QueueOverlay Props
 */
interface QueueOverlayProps {
  onClose: () => void;
  /** Called when user wants to send a message immediately */
  onSendNow?: (message: QueuedMessage) => void;
}

/**
 * Format timestamp for display (e.g., "12:34:56")
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Truncate content for preview (max 60 chars)
 */
function truncateContent(content: string, maxLength = 60): string {
  const oneLine = content.replace(/\n/g, " ").trim();
  if (oneLine.length <= maxLength) return oneLine;
  return oneLine.slice(0, maxLength - 3) + "...";
}

/**
 * QueueOverlay Component
 * Modal overlay for viewing and managing queued messages
 * 
 * Features:
 * - View all queued messages
 * - Edit message content
 * - Delete messages
 * - Reorder messages (move up/down)
 * - Send message immediately
 * - Clear entire queue
 * 
 * Keyboard shortcuts:
 * - Esc: Close overlay
 * - Up/Down: Navigate messages
 * - e: Edit selected message
 * - d/Delete: Delete selected message
 * - k: Move up
 * - j: Move down
 * - Enter: Send selected message now
 * - c: Clear all messages
 */
export function QueueOverlay(props: QueueOverlayProps) {
  const queue = useQueue();
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editContent, setEditContent] = createSignal("");

  // Keep selection in bounds when queue changes
  createEffect(() => {
    const count = queue.count();
    if (selectedIndex() >= count && count > 0) {
      setSelectedIndex(count - 1);
    }
  });

  const selectedMessage = () => {
    const messages = queue.messages();
    return messages[selectedIndex()];
  };

  useAppKeyboard((key) => {
    // If editing, only handle Escape and Enter
    if (editingId()) {
      if (key.name === "escape") {
        setEditingId(null);
        setEditContent("");
      } else if (key.name === "return") {
        const id = editingId();
        if (id) {
          queue.update(id, editContent());
          setEditingId(null);
          setEditContent("");
        }
      }
      return;
    }

    // Normal mode keyboard handling
    if (key.name === "escape") {
      props.onClose();
      return;
    }

    if (key.name === "up" || key.name === "k") {
      if (!key.ctrl) {
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else {
        // Ctrl+K: Move message up
        const msg = selectedMessage();
        if (msg) {
          queue.moveUp(msg.id);
          setSelectedIndex((i) => Math.max(0, i - 1));
        }
      }
      return;
    }

    if (key.name === "down" || key.name === "j") {
      if (!key.ctrl) {
        setSelectedIndex((i) => Math.min(queue.count() - 1, i + 1));
      } else {
        // Ctrl+J: Move message down
        const msg = selectedMessage();
        if (msg) {
          queue.moveDown(msg.id);
          setSelectedIndex((i) => Math.min(queue.count() - 1, i + 1));
        }
      }
      return;
    }

    // e: Edit selected message
    if (key.name === "e") {
      const msg = selectedMessage();
      if (msg) {
        setEditingId(msg.id);
        setEditContent(msg.content);
      }
      return;
    }

    // d or Delete: Delete selected message
    if (key.name === "d" || key.name === "delete" || key.name === "backspace") {
      const msg = selectedMessage();
      if (msg) {
        queue.remove(msg.id);
      }
      return;
    }

    // Enter: Send selected message now
    if (key.name === "return") {
      const msg = selectedMessage();
      if (msg && props.onSendNow) {
        queue.remove(msg.id);
        props.onSendNow(msg);
        props.onClose();
      }
      return;
    }

    // c: Clear all messages (with confirmation via double-press)
    if (key.name === "c" && key.ctrl) {
      queue.clear();
      return;
    }
  });

  return (
    <box
      position="absolute"
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <box
        border
        title="Message Queue"
        flexDirection="column"
        padding={1}
        width={80}
        maxHeight={24}
        backgroundColor="#1a1a1a"
      >
        {/* Header with count */}
        <box flexDirection="row" marginBottom={1}>
          <text fg={Colors.ui.text}>
            <strong>Queued Messages</strong>
          </text>
          <box flexGrow={1} />
          <text fg={Colors.ui.dim}>
            {queue.count()} message{queue.count() !== 1 ? "s" : ""}
          </text>
        </box>

        {/* Divider */}
        <text fg={Colors.ui.dim}>{"─".repeat(76)}</text>

        {/* Empty state */}
        <Show when={queue.count() === 0}>
          <box marginTop={2} marginBottom={2}>
            <text fg={Colors.ui.dim}>No messages queued.</text>
          </box>
          <text fg={Colors.ui.dim}>
            Type while AI is processing to add messages to the queue.
          </text>
        </Show>

        {/* Message list */}
        <Show when={queue.count() > 0}>
          <box flexDirection="column" marginTop={1}>
            <For each={queue.messages()}>
              {(msg, index) => {
                const isSelected = () => index() === selectedIndex();
                const isEditing = () => editingId() === msg.id;

                // Non-selected row (simple)
                if (!isSelected()) {
                  return (
                    <box flexDirection="row" paddingLeft={1} paddingRight={1}>
                      <text fg={Colors.ui.dim}>{" "}</text>
                      <text fg={Colors.ui.dim}>
                        {String(index() + 1).padStart(2, " ")}.
                      </text>
                      <text fg={Colors.ui.dim}> [{formatTime(msg.timestamp)}] </text>
                      <text fg={Colors.ui.dim}>
                        {truncateContent(msg.content)}
                      </text>
                    </box>
                  );
                }

                // Selected row (highlighted)
                return (
                  <box
                    flexDirection="row"
                    backgroundColor="#2a2a2a"
                    paddingLeft={1}
                    paddingRight={1}
                  >
                    <text fg={Colors.ui.primary}>{">"}</text>
                    <text fg={Colors.ui.dim}>
                      {String(index() + 1).padStart(2, " ")}.
                    </text>
                    <text fg={Colors.ui.dim}> [{formatTime(msg.timestamp)}] </text>
                    <Show
                      when={!isEditing()}
                      fallback={
                        <box flexGrow={1}>
                          <input
                            value={editContent()}
                            onInput={(v) => setEditContent(v)}
                            focused
                            width={50}
                          />
                        </box>
                      }
                    >
                      <text fg={Colors.ui.text}>
                        {truncateContent(msg.content)}
                      </text>
                    </Show>
                  </box>
                );
              }}
            </For>
          </box>

          {/* Help text */}
          <box marginTop={2}>
            <text fg={Colors.ui.dim}>{"─".repeat(76)}</text>
          </box>
          <box flexDirection="row" marginTop={1}>
            <text fg={Colors.ui.dim}>
              {"  "}Up/Down: Navigate | e: Edit | d: Delete | Enter: Send now | Ctrl+C: Clear all
            </text>
          </box>
          <box flexDirection="row">
            <text fg={Colors.ui.dim}>
              {"  "}Ctrl+K/J: Move up/down | Esc: Close
            </text>
          </box>
        </Show>
      </box>
    </box>
  );
}
