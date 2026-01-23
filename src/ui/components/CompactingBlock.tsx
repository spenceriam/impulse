import { Show } from "solid-js";
import { Colors } from "../design";
import { BouncingDots } from "./BouncingDots";

/**
 * Compacting Block Component
 * Shows compaction status in the chat view
 * 
 * States:
 * - "compacting": Shows "Compacting conversation..." with bouncing dots
 * - "complete": Shows "Compact complete. Conversation continuing."
 * 
 * Props:
 * - status: "compacting" | "complete"
 * - removedCount: Number of messages that were compacted (shown on complete)
 */

interface CompactingBlockProps {
  status: "compacting" | "complete";
  removedCount?: number;
}

// Background color matches system messages
const SYSTEM_BG = "#1a1a2a";  // Dark blue tint for system messages

// Thin accent line character
const THIN_LINE = "─";

export function CompactingBlock(props: CompactingBlockProps) {
  const isCompacting = () => props.status === "compacting";
  const removedCount = () => props.removedCount ?? 0;

  return (
    <box 
      flexDirection="column" 
      marginBottom={1}
      width="100%"
      minWidth={0}
      overflow="hidden"
    >
      {/* Top accent line - purple (system color) */}
      <box height={1} width="100%" overflow="hidden">
        <text fg={Colors.mode.PLANNER}>{THIN_LINE.repeat(200)}</text>
      </box>
      
      {/* Message content area */}
      <box 
        flexDirection="column"
        backgroundColor={SYSTEM_BG}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
        width="100%"
        minWidth={0}
        overflow="hidden"
      >
        <Show
          when={isCompacting()}
          fallback={
            // Complete state
            <box flexDirection="column">
              <box flexDirection="row">
                <text fg={Colors.status.success}>{"\u2713"} </text>
                <text fg={Colors.ui.text}>
                  <strong>Compact complete</strong>
                </text>
              </box>
              <Show when={removedCount() > 0}>
                <text fg={Colors.ui.dim}>
                  Summarized {removedCount()} messages. Conversation continuing.
                </text>
              </Show>
            </box>
          }
        >
          {/* Compacting state */}
          <box flexDirection="row">
            <text fg={Colors.ui.text}>Compacting conversation </text>
            <BouncingDots color={Colors.mode.PLANNER} />
          </box>
        </Show>
      </box>
      
      {/* Bottom accent line - purple */}
      <box height={1} width="100%" overflow="hidden">
        <text fg={Colors.mode.PLANNER}>{THIN_LINE.repeat(200)}</text>
      </box>
    </box>
  );
}
