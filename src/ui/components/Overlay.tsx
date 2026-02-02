import { createSignal, Show, For, JSX } from "solid-js";
import { useAppKeyboard } from "../context/keyboard";
import { Colors } from "../design";

/**
 * Overlay mode
 */
export type OverlayMode =
  | "command-palette"
  | "mcp-status"
  | "session-stats"
  | "help"
  | "config"
  | null;

/**
 * Command option for palette
 */
export interface CommandOption {
  name: string;
  description: string;
  shortcut?: string;
  action: () => void;
}

/**
 * Overlay Props
 */
interface OverlayProps {
  mode: OverlayMode;
  onClose: () => void;
  commands?: CommandOption[];
}

/**
 * Overlay Component
 * Modal overlay for commands, dialogs, and informational displays
 */
export function Overlay(props: OverlayProps) {
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  useAppKeyboard((key) => {
    if (key.name === "escape") {
      props.onClose();
    }
  });

  const handleSelect = (index: number) => {
    setSelectedIndex(index);
    props.commands?.[index]?.action();
  };

  const renderContent = (): JSX.Element => {
    switch (props.mode) {
      case "command-palette":
        return (
          <box flexDirection="column">
            <text><strong>Command Palette</strong></text>
            <text>────────────────</text>
            <Show when={props.commands && props.commands.length > 0}>
              <box flexDirection="column" marginTop={1}>
                <For each={props.commands!}>
                  {(cmd, i) => (
                    <box
                      flexDirection="row"
                      // @ts-ignore: OpenTUI types incomplete
                      onMouseDown={() => handleSelect(i())}
                    >
                      <text fg={i() === selectedIndex() ? Colors.ui.primary : Colors.ui.text}>
                        {i() === selectedIndex() ? ">" : " "}
                      </text>
                      <text>{cmd.name}</text>
                      <text fg={Colors.ui.dim}> - {cmd.description}</text>
                      <Show when={cmd.shortcut}>
                        <box flexGrow={1} />
                        <text fg={Colors.ui.dim}>({cmd.shortcut})</text>
                      </Show>
                    </box>
                  )}
                </For>
              </box>
            </Show>
          </box>
        );

      case "mcp-status":
        return (
          <box flexDirection="column">
            <text><strong>MCP Status</strong></text>
            <text>─────────────</text>
            <box flexDirection="column" marginTop={1}>
              <text fg={Colors.status.success}>Vision: Connected</text>
              <text fg={Colors.status.success}>Web Search: Connected</text>
              <text fg={Colors.status.success}>Web Reader: Connected</text>
              <text fg={Colors.status.success}>Zread: Connected</text>
            </box>
          </box>
        );

      case "session-stats":
        return (
          <box flexDirection="column">
            <text><strong>Session Statistics</strong></text>
            <text>───────────────────────</text>
            <box flexDirection="column" marginTop={1}>
              <text>Messages: 5</text>
              <text>Tokens: 8,450</text>
              <text>Cost: $0.12</text>
              <text>Duration: 12m 34s</text>
            </box>
          </box>
        );

      case "help":
        return (
          <box flexDirection="column">
            <text><strong>Keyboard Shortcuts</strong></text>
            <text>───────────────────────</text>
            <box flexDirection="column" marginTop={1}>
              <text>Tab        - Cycle modes</text>
              <text>Shift+Tab  - Reverse cycle modes</text>
              <text>Enter      - Submit / Select</text>
              <text>Esc (2x)   - Cancel operation</text>
              <text>Ctrl+C (2x) - Exit</text>
              <text>Ctrl+P     - Command palette</text>
              <text>Ctrl+M     - MCP status</text>
            </box>
          </box>
        );

      default:
        return <text>Unknown overlay mode</text>;
    }
  };

  return (
    <Show when={props.mode !== null}>
      <box
        flexDirection="column"
        width="100%"
        height="100%"
        // @ts-ignore: OpenTUI types incomplete
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.8)",
        }}
        padding={4}
      >
        <box
          border
          flexDirection="column"
          padding={2}
          width={50}
          // @ts-ignore: OpenTUI types incomplete
          style={{
            backgroundColor: "#000000",
          }}
        >
          <text fg={Colors.ui.dim}>(Esc to close)</text>
          {renderContent()}
        </box>
      </box>
    </Show>
  );
}
