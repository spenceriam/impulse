import { createSignal, Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { Colors } from "../design";
import type { PermissionRequest, PermissionResponse } from "../../permission";
import { getPermissionLabel } from "../../permission";

/**
 * PermissionPrompt Props
 */
interface PermissionPromptProps {
  request: PermissionRequest;
  onRespond: (response: PermissionResponse, message?: string) => void;
}

/**
 * PermissionPrompt Component
 * 
 * Displays a permission request from a tool with options to allow/reject.
 * Renders inline (not as modal) with left border accent.
 * 
 * Layout:
 * ┃ Permission required
 * ┃
 * ┃ -> Edit src/api/client.ts
 * ┃
 * ┃ [diff preview if available]
 * ┃
 * ┃ [Allow once]  [Allow always]  [Reject]
 * ┃
 * ┃ left/right select  enter confirm  esc reject
 */
export function PermissionPrompt(props: PermissionPromptProps) {
  const options: { key: PermissionResponse; label: string }[] = [
    { key: "once", label: "Allow once" },
    { key: "always", label: "Allow always" },
    { key: "reject", label: "Reject" },
  ];
  
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  
  const selected = () => options[selectedIndex()]!;
  
  // Handle keyboard navigation
  useKeyboard((key) => {
    // Left/right to navigate options
    if (key.name === "left" || key.name === "h") {
      setSelectedIndex((i) => (i - 1 + options.length) % options.length);
      return;
    }
    if (key.name === "right" || key.name === "l") {
      setSelectedIndex((i) => (i + 1) % options.length);
      return;
    }
    
    // Enter to confirm selection
    if (key.name === "return") {
      props.onRespond(selected().key);
      return;
    }
    
    // Escape to reject
    if (key.name === "escape") {
      props.onRespond("reject");
      return;
    }
  });

  // Get icon based on permission type
  const getIcon = () => {
    switch (props.request.permission) {
      case "edit":
        return "->";
      case "write":
        return "+";
      case "bash":
        return "$";
      case "task":
        return "*";
      default:
        return ">";
    }
  };

  // Format the permission description
  const getDescription = () => {
    const patterns = props.request.patterns;
    const label = getPermissionLabel(props.request.permission);
    
    if (patterns.length === 1) {
      return `${label} ${patterns[0]}`;
    }
    return `${label} ${patterns.length} items`;
  };

  return (
    <box
      flexDirection="column"
      border={["left"]}
      borderColor={Colors.status.warning}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor="#1a1a1a"
    >
      {/* Header */}
      <box flexDirection="row" gap={1}>
        <text fg={Colors.status.warning}>{"*"}</text>
        <text fg={Colors.ui.text}>Permission required</text>
      </box>
      
      <box height={1} />
      
      {/* Description */}
      <box flexDirection="row" gap={1} paddingLeft={1}>
        <text fg={Colors.ui.dim}>{getIcon()}</text>
        <text fg={Colors.ui.dim}>{getDescription()}</text>
      </box>
      
      {/* Show custom message if provided */}
      <Show when={props.request.message && props.request.message !== getDescription()}>
        <box paddingLeft={3}>
          <text fg={Colors.ui.text}>{props.request.message}</text>
        </box>
      </Show>
      
      {/* Show diff preview for edit operations */}
      <Show when={props.request.metadata?.["diff"]}>
        <box height={1} />
        <box
          border
          borderColor={Colors.ui.dim}
          paddingLeft={1}
          paddingRight={1}
          maxHeight={10}
        >
          <scrollbox height="100%">
            <text fg={Colors.ui.dim}>{String(props.request.metadata?.["diff"])}</text>
          </scrollbox>
        </box>
      </Show>
      
      {/* Show command for bash operations */}
      <Show when={props.request.permission === "bash" && props.request.metadata?.["command"]}>
        <box paddingLeft={3}>
          <text fg={Colors.ui.text}>$ {String(props.request.metadata?.["command"])}</text>
        </box>
      </Show>
      
      <box height={1} />
      
      {/* Options */}
      <box flexDirection="row" gap={1}>
        <For each={options}>
          {(option, i) => {
            const isSelected = () => i() === selectedIndex();
            const bgColor = (): string => {
              if (!isSelected()) return "transparent";
              if (option.key === "reject") return Colors.status.error;
              return Colors.status.warning;
            };
            
            return (
              <Show
                when={isSelected()}
                fallback={
                  <box paddingLeft={1} paddingRight={1}>
                    <text fg={Colors.ui.dim}>{option.label}</text>
                  </box>
                }
              >
                <box
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={bgColor()}
                >
                  <text fg="#000000">{option.label}</text>
                </box>
              </Show>
            );
          }}
        </For>
      </box>
      
      <box height={1} />
      
      {/* Hints */}
      <box flexDirection="row" gap={2}>
        <text fg={Colors.ui.dim}>left/right select</text>
        <text fg={Colors.ui.dim}>enter confirm</text>
        <text fg={Colors.ui.dim}>esc reject</text>
      </box>
    </box>
  );
}
