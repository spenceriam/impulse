import { For, Show, createMemo } from "solid-js";
import { Colors } from "../design";
import { useQueue } from "../context/queue";

/**
 * QueueBar Component
 * Stacked preview of queued messages above the prompt
 * 
 * Behavior:
 * - Shows up to 3 queued messages
 * - If more, add an overflow line with count and Ctrl+Q hint
 * - No border, dim prefix, normal text content
 */

const MAX_VISIBLE = 3;
const PREVIEW_MAX_LEN = 80;

function truncateQueueContent(content: string, maxLength: number): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLength) return oneLine;
  return oneLine.slice(0, Math.max(0, maxLength - 3)) + "...";
}

export function getQueueBarHeight(count: number): number {
  if (count <= 0) return 0;
  return Math.min(count, MAX_VISIBLE) + (count > MAX_VISIBLE ? 1 : 0);
}

export function QueueBar() {
  const queue = useQueue();
  
  const visibleMessages = createMemo(() => queue.messages().slice(0, MAX_VISIBLE));
  const overflowCount = createMemo(() => Math.max(0, queue.count() - MAX_VISIBLE));
  const height = createMemo(() => getQueueBarHeight(queue.count()));
  
  return (
    <Show when={queue.count() > 0}>
      <box
        flexDirection="column"
        height={height()}
        width="100%"
        paddingLeft={1}
        paddingRight={1}
      >
        <For each={visibleMessages()}>
          {(msg, index) => (
            <box height={1} flexDirection="row">
              <text fg={Colors.ui.dim}>{`[Enter] ${index() + 1}) `}</text>
              <text fg={Colors.ui.text}>
                {truncateQueueContent(msg.content, PREVIEW_MAX_LEN)}
              </text>
            </box>
          )}
        </For>
        <Show when={overflowCount() > 0}>
          <box height={1}>
            <text fg={Colors.ui.dim}>
              {`... +${overflowCount()} more (Ctrl+Q to manage)`}
            </text>
          </box>
        </Show>
      </box>
    </Show>
  );
}
