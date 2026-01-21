import { createSignal, Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { Colors, Indicators } from "../design";
import type { PermissionRequest, PermissionResponse } from "../../permission";

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
 * Brutalist design matching glm-cli aesthetic.
 * Displays permission request with options to allow/reject.
 * 
 * Layout:
 * [[━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━]]
 *   * Permission required
 *   
 *   $ Execute command
 *     ls -la
 *   
 *   [Y] Allow once   [A] Allow always   [N] Reject
 *   
 *   Y/A/N or arrows + enter | esc to reject
 * [[━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━]]
 */
export function PermissionPrompt(props: PermissionPromptProps) {
  const options: { key: PermissionResponse; label: string; hotkey: string }[] = [
    { key: "once", label: "Allow once", hotkey: "Y" },
    { key: "always", label: "Allow always", hotkey: "A" },
    { key: "reject", label: "Reject", hotkey: "N" },
  ];
  
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  
  const selected = () => options[selectedIndex()]!;
  
  // Handle keyboard navigation
  useKeyboard((key) => {
    // Hotkeys
    if (key.name === "y") {
      props.onRespond("once");
      return;
    }
    if (key.name === "a") {
      props.onRespond("always");
      return;
    }
    if (key.name === "n") {
      props.onRespond("reject");
      return;
    }
    
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
        return Indicators.collapsed; // ▶
      case "write":
        return "+";
      case "bash":
        return "$";
      case "task":
        return "*";
      default:
        return Indicators.dot; // ●
    }
  };

  // Get permission type label
  const getLabel = () => {
    switch (props.request.permission) {
      case "edit":
        return "Edit file";
      case "write":
        return "Create file";
      case "bash":
        return "Execute command";
      case "task":
        return "Launch subagent";
      default:
        return props.request.permission || "Action";
    }
  };

  // Format the permission description
  const getDescription = () => {
    const patterns = props.request.patterns ?? [];
    const label = getLabel();
    
    if (patterns.length === 0) {
      return label;
    }
    if (patterns.length === 1) {
      return `${label}: ${patterns[0]}`;
    }
    return `${label}: ${patterns.length} items`;
  };

  // Bracket line width
  const lineWidth = 70;
  const bracketLine = `[[${("━").repeat(lineWidth - 4)}]]`;

  return (
    <box flexDirection="column" paddingLeft={4} paddingRight={4}>
      {/* Top bracket */}
      <text fg={Colors.status.warning}>{bracketLine}</text>
      
      <box height={1} />
      
      {/* Header */}
      <box flexDirection="row">
        <text fg={Colors.status.warning}>{Indicators.dot} </text>
        <text fg={Colors.ui.text}>Permission required</text>
      </box>
      
      <box height={1} />
      
      {/* Description */}
      <box flexDirection="row" paddingLeft={2}>
        <text fg={Colors.mode.AGENT}>{getIcon()} </text>
        <text fg={Colors.ui.text}>{getDescription()}</text>
      </box>
      
      {/* Show custom message if different from description */}
      <Show when={props.request.message && props.request.message !== getDescription()}>
        <box paddingLeft={4}>
          <text fg={Colors.ui.dim}>{props.request.message}</text>
        </box>
      </Show>
      
      {/* Show command for bash operations */}
      <Show when={props.request.permission === "bash" && props.request.metadata?.["command"]}>
        <box paddingLeft={4}>
          <text fg={Colors.ui.dim}>$ {String(props.request.metadata?.["command"])}</text>
        </box>
      </Show>
      
      {/* Show diff preview for edit operations */}
      <Show when={props.request.metadata?.["diff"]}>
        <box height={1} />
        <box paddingLeft={2} paddingRight={2}>
          <scrollbox height={6} border borderColor={Colors.ui.dim}>
            <text fg={Colors.ui.dim}>{String(props.request.metadata?.["diff"])}</text>
          </scrollbox>
        </box>
      </Show>
      
      <box height={1} />
      
      {/* Options with hotkeys */}
      <box flexDirection="row" paddingLeft={2}>
        <For each={options}>
          {(option, i) => {
            const isSelected = () => i() === selectedIndex();
            
            return (
              <box flexDirection="row" marginRight={2}>
                <Show
                  when={isSelected()}
                  fallback={
                    <>
                      <text fg={Colors.ui.dim}>[{option.hotkey}] </text>
                      <text fg={Colors.ui.dim}>{option.label}</text>
                    </>
                  }
                >
                  <box backgroundColor={option.key === "reject" ? Colors.status.error : Colors.mode.AGENT}>
                    <text fg="#000000">[{option.hotkey}] {option.label}</text>
                  </box>
                </Show>
              </box>
            );
          }}
        </For>
      </box>
      
      <box height={1} />
      
      {/* Hints */}
      <box paddingLeft={2}>
        <text fg={Colors.ui.dim}>Y/A/N or left/right + enter | esc to reject</text>
      </box>
      
      <box height={1} />
      
      {/* Bottom bracket */}
      <text fg={Colors.status.warning}>{bracketLine}</text>
    </box>
  );
}
