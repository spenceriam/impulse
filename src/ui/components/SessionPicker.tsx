import { createSignal, Show, For, createMemo, onMount } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { Colors } from "../design";
import { Session } from "../../session/store";
import { SessionManager } from "../../session/manager";

// Column widths for alignment
const NAME_COL_WIDTH = 30;
const UPDATED_COL_WIDTH = 20;
const MSGS_COL_WIDTH = 6;

// Fixed height for scrollable session list (max visible rows)
const MAX_VISIBLE_ROWS = 10;

/**
 * Format a relative time string
 */
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  // Format as date
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Truncate a string with ellipsis
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}

/**
 * Truncate path for display (use ~ for home)
 */
function truncatePath(path: string | undefined, maxLen: number): string {
  if (!path) return "";
  
  // Replace home directory with ~
  const home = process.env["HOME"] || "";
  let displayPath = path;
  if (home && path.startsWith(home)) {
    displayPath = "~" + path.slice(home.length);
  }
  
  return truncate(displayPath, maxLen);
}

/**
 * Get preview text from session messages
 */
function getPreview(session: Session): { user: string; assistant: string } | null {
  if (session.messages.length === 0) return null;
  
  const userMsg = session.messages.find(m => m.role === "user");
  const assistantMsg = session.messages.find(m => m.role === "assistant");
  
  if (!userMsg) return null;
  
  return {
    user: truncate(userMsg.content.replace(/\n/g, " "), 80),
    assistant: assistantMsg 
      ? truncate(assistantMsg.content.replace(/\n/g, " "), 80)
      : "",
  };
}

/**
 * SessionPickerOverlay Props
 */
interface SessionPickerOverlayProps {
  onSelect: (session: Session) => void;
  onCancel: () => void;
}

/**
 * SessionPickerOverlay Component
 * Interactive session picker with preview
 */
export function SessionPickerOverlay(props: SessionPickerOverlayProps) {
  const [sessions, setSessions] = createSignal<Session[]>([]);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [loading, setLoading] = createSignal(true);

  // Load sessions on mount
  onMount(async () => {
    try {
      const list = await SessionManager.listSessions();
      // Sort by updated_at descending (most recent first)
      list.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      setSessions(list);
    } catch (error) {
      console.error("Failed to load sessions:", error);
    } finally {
      setLoading(false);
    }
  });

  // Get currently selected session
  const selectedSession = createMemo(() => {
    const list = sessions();
    const idx = selectedIndex();
    return list[idx] || null;
  });

  // Get preview for selected session
  const preview = createMemo(() => {
    const session = selectedSession();
    return session ? getPreview(session) : null;
  });

  // Keyboard navigation
  useKeyboard((key) => {
    if (key.name === "escape") {
      props.onCancel();
      return;
    }

    if (key.name === "up") {
      setSelectedIndex(i => Math.max(0, i - 1));
      return;
    }

    if (key.name === "down") {
      setSelectedIndex(i => Math.min(sessions().length - 1, i + 1));
      return;
    }

    if (key.name === "return") {
      const session = selectedSession();
      if (session) {
        props.onSelect(session);
      }
      return;
    }
  });

  // Calculate remaining width for directory column
  const dirColWidth = 25;

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
        title="Load Session"
        flexDirection="column"
        padding={1}
        width={95}
        backgroundColor="#1a1a1a"
      >
        <Show
          when={!loading()}
          fallback={
            <box padding={2}>
              <text fg={Colors.ui.dim}>Loading sessions...</text>
            </box>
          }
        >
          <Show
            when={sessions().length > 0}
            fallback={
              <box flexDirection="column" padding={2} alignItems="center">
                <box height={2} />
                <text fg={Colors.ui.dim}>No saved sessions for this project.</text>
                <box height={1} />
                <text fg={Colors.ui.dim}>Start a conversation and use /save to</text>
                <text fg={Colors.ui.dim}>create your first saved session.</text>
                <box height={2} />
              </box>
            }
          >
            {/* Header row */}
            <box flexDirection="row">
              <text fg={Colors.ui.dim}>{" NAME".padEnd(NAME_COL_WIDTH)}</text>
              <text fg={Colors.ui.dim}>{"UPDATED".padEnd(UPDATED_COL_WIDTH)}</text>
              <text fg={Colors.ui.dim}>{"MSGS".padEnd(MSGS_COL_WIDTH)}</text>
              <text fg={Colors.ui.dim}>DIRECTORY</text>
            </box>
            <box height={1} />

            {/* Session rows - fixed height scrollbox */}
            <box 
              border 
              borderColor={Colors.ui.dim}
              height={Math.min(sessions().length + 2, MAX_VISIBLE_ROWS + 2)}
            >
              <scrollbox
                height={Math.min(sessions().length, MAX_VISIBLE_ROWS)}
                style={{
                  scrollbarOptions: {
                    trackOptions: {
                      foregroundColor: Colors.mode.AGENT,
                      backgroundColor: Colors.ui.dim,
                    },
                  },
                }}
              >
                <box flexDirection="column">
                  <For each={sessions()}>
                    {(session, index) => {
                      const isSelected = () => index() === selectedIndex();
                      const name = truncate(session.name || session.headerTitle || "Untitled", NAME_COL_WIDTH - 1);
                      const updated = formatRelativeTime(session.updated_at);
                      const msgCount = session.messages.length.toString();
                      const dir = truncatePath(session.directory, dirColWidth);

                      // Build row content with padding
                      const nameCol = (" " + name).padEnd(NAME_COL_WIDTH);
                      const updatedCol = updated.padEnd(UPDATED_COL_WIDTH);
                      const msgsCol = msgCount.padEnd(MSGS_COL_WIDTH);

                      return (
                        <Show
                          when={isSelected()}
                          fallback={
                            <box flexDirection="row">
                              <text fg={Colors.ui.text}>{nameCol}</text>
                              <text fg={Colors.ui.dim}>{updatedCol}</text>
                              <text fg={Colors.ui.dim}>{msgsCol}</text>
                              <text fg={Colors.ui.dim}>{dir}</text>
                            </box>
                          }
                        >
                          <box flexDirection="row" backgroundColor={Colors.mode.AGENT}>
                            <text fg="#000000">{nameCol}</text>
                            <text fg="#000000">{updatedCol}</text>
                            <text fg="#000000">{msgsCol}</text>
                            <text fg="#000000">{dir}</text>
                          </box>
                        </Show>
                      );
                    }}
                  </For>
                </box>
              </scrollbox>
            </box>

            {/* Session count indicator */}
            <box height={1}>
              <text fg={Colors.ui.dim}>
                {` ${sessions().length} session${sessions().length === 1 ? "" : "s"} for this project`}
              </text>
            </box>

            {/* Preview section */}
            <text fg={Colors.ui.dim}>{"─".repeat(91)}</text>
            <box height={1} />
            
            <Show
              when={preview()}
              fallback={
                <box flexDirection="column">
                  <text fg={Colors.ui.dim}>Preview</text>
                  <text fg={Colors.ui.dim}>────────</text>
                  <text fg={Colors.ui.dim}>(empty session)</text>
                </box>
              }
            >
              <box flexDirection="column">
                <text fg={Colors.ui.dim}>Preview</text>
                <text fg={Colors.ui.dim}>────────</text>
                <box flexDirection="row">
                  <text fg={Colors.ui.dim}>You: </text>
                  <text fg={Colors.ui.text}>{preview()!.user}</text>
                </box>
                <Show when={preview()!.assistant}>
                  <box flexDirection="row">
                    <text fg={Colors.ui.dim}>{selectedSession()?.model || "GLM"}: </text>
                    <text fg={Colors.ui.text}>{preview()!.assistant}</text>
                  </box>
                </Show>
              </box>
            </Show>
          </Show>
        </Show>

        {/* Footer */}
        <box height={1} />
        <text fg={Colors.ui.dim}>
          {sessions().length > 0
            ? " Up/Down: navigate | Enter: load | Esc: cancel"
            : " Esc: close"}
        </text>
      </box>
    </box>
  );
}
