import { createSignal, Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { Colors, Indicators } from "../design";
import type { PermissionRequest, PermissionResponse } from "../../permission";

/**
 * Permission option definition
 */
interface PermissionOption {
  key: PermissionResponse;
  label: string;
  description: string;
  hotkey: string;
}

/**
 * PermissionPrompt Props
 */
interface PermissionPromptProps {
  request: PermissionRequest;
  onRespond: (response: PermissionResponse, message?: string) => void;
}

// Column widths for alignment
const CHECKBOX_COL_WIDTH = 5;  // "[ ] "
const LABEL_COL_WIDTH = 18;    // "Allow session  "
const HOTKEY_COL_WIDTH = 5;    // "[1] "

/**
 * PermissionPrompt Component
 * 
 * Styled to match ModelSelectOverlay - table layout with highlight row.
 * 
 * Layout:
 * ┌─ Permission Required ────────────────────────────────────────────────┐
 * │                                                                      │
 * │  $ Execute command                                                   │
 * │  rm -rf node_modules                                                 │
 * │                                                                      │
 * │       RESPONSE          KEY   DESCRIPTION                            │
 * │                                                                      │
 * │  [x]  Allow once        [1]   Permit this specific action only       │  <- highlighted
 * │  [ ]  Allow session     [2]   Auto-approve pattern for session       │
 * │  [ ]  Allow always      [3]   Save to project config                 │
 * │  [ ]  Reject            [4]   Deny this action                       │
 * │                                                                      │
 * │  ↑/↓: Navigate  Enter: Confirm  1-4: Quick select  Esc: Reject       │
 * └──────────────────────────────────────────────────────────────────────┘
 */
export function PermissionPrompt(props: PermissionPromptProps) {
  const options: PermissionOption[] = [
    { key: "once", label: "Allow once", description: "Permit this specific action only", hotkey: "1" },
    { key: "session", label: "Allow session", description: "Auto-approve pattern for session", hotkey: "2" },
    { key: "always", label: "Allow always", description: "Save to project config", hotkey: "3" },
    { key: "reject", label: "Reject", description: "Deny this action", hotkey: "4" },
  ];
  
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  
  const selected = () => options[selectedIndex()]!;
  
  // Handle keyboard navigation
  useKeyboard((key) => {
    // Number hotkeys for quick selection
    if (key.name === "1") {
      props.onRespond("once");
      return;
    }
    if (key.name === "2") {
      props.onRespond("session");
      return;
    }
    if (key.name === "3") {
      props.onRespond("always");
      return;
    }
    if (key.name === "4" || key.name === "n") {
      props.onRespond("reject");
      return;
    }
    
    // Letter hotkeys (y for once, s for session, a for always)
    if (key.name === "y") {
      props.onRespond("once");
      return;
    }
    if (key.name === "s") {
      props.onRespond("session");
      return;
    }
    if (key.name === "a") {
      props.onRespond("always");
      return;
    }
    
    // Up/down to navigate options
    if (key.name === "up" || key.name === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.name === "down" || key.name === "j") {
      setSelectedIndex((i) => Math.min(options.length - 1, i + 1));
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

  // Get reason for permission request
  const getReason = () => {
    return props.request.metadata?.["reason"] as string | undefined;
  };

  // Truncate long strings for display
  const truncate = (str: string, max: number) => {
    if (str.length <= max) return str;
    return str.slice(0, max - 3) + "...";
  };

  // Line width for content
  const lineWidth = 76;

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
        title="Permission Required"
        borderColor={Colors.status.warning}
        flexDirection="column"
        padding={1}
        width={lineWidth}
        backgroundColor="#1a1a1a"
      >
        {/* Action info section */}
        <box flexDirection="column" marginBottom={1}>
          {/* Permission type with icon */}
          <box flexDirection="row">
            <text fg={Colors.status.warning}>{getIcon()} </text>
            <text fg={Colors.ui.text}>{getLabel()}</text>
          </box>
          
          {/* Action description (from message field) */}
          <Show when={props.request.message}>
            <box paddingLeft={2}>
              <text fg={Colors.ui.dim}>{props.request.message}</text>
            </box>
          </Show>
          
          {/* Reason why permission is needed */}
          <Show when={getReason()}>
            <box paddingLeft={2}>
              <text fg={Colors.ui.dim}>Reason: {getReason()}</text>
            </box>
          </Show>
        </box>
        
        {/* Show patterns (file paths, commands) */}
        <Show when={props.request.patterns && props.request.patterns.length > 0}>
          <box flexDirection="column" marginBottom={1}>
            <text fg={Colors.ui.dim}>Target:</text>
            <For each={props.request.patterns}>
              {(pattern) => (
                <box paddingLeft={2}>
                  <text fg={Colors.ui.text}>{truncate(pattern, lineWidth - 8)}</text>
                </box>
              )}
            </For>
          </box>
        </Show>
        
        {/* Show working directory for bash */}
        <Show when={props.request.permission === "bash" && props.request.metadata?.["workdir"]}>
          <box marginBottom={1}>
            <text fg={Colors.ui.dim}>Directory: {String(props.request.metadata?.["workdir"])}</text>
          </box>
        </Show>
        
        {/* Show old/new strings for edit operations */}
        <Show when={props.request.permission === "edit" && props.request.metadata?.["oldString"]}>
          <box flexDirection="column" marginBottom={1}>
            <text fg={Colors.ui.dim}>Change:</text>
            <box paddingLeft={2} flexDirection="column">
              <text fg={Colors.diff.deletion}>- {truncate(String(props.request.metadata?.["oldString"]), lineWidth - 8)}</text>
              <text fg={Colors.diff.addition}>+ {truncate(String(props.request.metadata?.["newString"] || ""), lineWidth - 8)}</text>
            </box>
          </box>
        </Show>
        
        {/* Show content length for write operations */}
        <Show when={props.request.permission === "write" && props.request.metadata?.["contentLength"]}>
          <box marginBottom={1}>
            <text fg={Colors.ui.dim}>Content: {String(props.request.metadata?.["contentLength"])} bytes</text>
          </box>
        </Show>
        
        <box height={1} />
        
        {/* Header row */}
        <box flexDirection="row">
          <text fg={Colors.ui.dim}>{" ".repeat(CHECKBOX_COL_WIDTH)}</text>
          <text fg={Colors.ui.dim}>{"RESPONSE".padEnd(LABEL_COL_WIDTH)}</text>
          <text fg={Colors.ui.dim}>{"KEY".padEnd(HOTKEY_COL_WIDTH)}</text>
          <text fg={Colors.ui.dim}>DESCRIPTION</text>
        </box>
        
        <box height={1} />
        
        {/* Options rows - table style like ModelSelectOverlay */}
        <For each={options}>
          {(option, i) => {
            const isSelected = () => i() === selectedIndex();
            const checkbox = isSelected() ? "[x] " : "[ ] ";
            const labelCol = option.label.padEnd(LABEL_COL_WIDTH);
            const hotkeyCol = `[${option.hotkey}]`.padEnd(HOTKEY_COL_WIDTH);
            const isReject = option.key === "reject";
            
            // Highlight color: cyan for normal options, red for reject
            const highlightBg = isReject ? Colors.status.error : Colors.mode.AGENT;
            
            return (
              <Show
                when={isSelected()}
                fallback={
                  <box flexDirection="row">
                    <text fg={Colors.ui.dim}>{checkbox}</text>
                    <text fg={Colors.ui.text}>{labelCol}</text>
                    <text fg={Colors.ui.dim}>{hotkeyCol}</text>
                    <text fg={Colors.ui.dim}>{option.description}</text>
                  </box>
                }
              >
                <box flexDirection="row" backgroundColor={highlightBg}>
                  <text fg="#000000">{checkbox}</text>
                  <text fg="#000000">{labelCol}</text>
                  <text fg="#000000">{hotkeyCol}</text>
                  <text fg="#000000">{option.description}</text>
                </box>
              </Show>
            );
          }}
        </For>
        
        <box height={1} />
        
        {/* Hints */}
        <text fg={Colors.ui.dim}>↑/↓: Navigate  Enter: Confirm  1-4: Quick select  Esc: Reject</text>
      </box>
    </box>
  );
}
