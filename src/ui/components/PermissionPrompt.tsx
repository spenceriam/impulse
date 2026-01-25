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

/**
 * PermissionPrompt Component
 * 
 * Styled to match QuestionOverlay - vertical radio list with descriptions.
 * 
 * Layout:
 * [[━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━]]
 *
 *   ● Permission required
 *
 *   $ Execute command
 *   Reason: Destructive command: rm
 *
 *   Target:
 *     rm -rf node_modules
 *
 *   ─────────────────────────────────────────────────────────────────
 *
 *   (*) Allow once
 *       Permit this specific action only
 *
 *   ( ) Allow session
 *       Auto-approve this pattern for current session
 *
 *   ( ) Allow always
 *       Save to project config, applies to all future sessions
 *
 *   ( ) Reject
 *       Deny this action
 *
 *   ─────────────────────────────────────────────────────────────────
 *   ↑/↓: Navigate  Enter: Confirm  1/2/3/4: Quick select  Esc: Reject
 *
 * [[━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━]]
 */
export function PermissionPrompt(props: PermissionPromptProps) {
  const options: PermissionOption[] = [
    { key: "once", label: "Allow once", description: "Permit this specific action only", hotkey: "1" },
    { key: "session", label: "Allow session", description: "Auto-approve this pattern for current session", hotkey: "2" },
    { key: "always", label: "Allow always", description: "Save to project config, applies to all future sessions", hotkey: "3" },
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
  const lineWidth = 70;
  const dividerLine = "─".repeat(lineWidth - 8);

  return (
    <box flexDirection="column" paddingLeft={4} paddingRight={4} backgroundColor="#1a1a1a" width={lineWidth} border borderColor={Colors.status.warning}>
      <box height={1} />
      
      {/* Header */}
      <box flexDirection="row" paddingLeft={2}>
        <text fg={Colors.status.warning}>{Indicators.dot} </text>
        <text fg={Colors.status.warning}>Permission required</text>
      </box>
      
      <box height={1} />
      
      {/* Action description (from message field) - this tells WHAT is being done */}
      <Show when={props.request.message}>
        <box paddingLeft={2}>
          <text fg={Colors.ui.text}>{props.request.message}</text>
        </box>
        <box height={1} />
      </Show>
      
      {/* Permission type and icon */}
      <box flexDirection="row" paddingLeft={2}>
        <text fg={Colors.mode.AGENT}>{getIcon()} </text>
        <text fg={Colors.ui.dim}>{getLabel()}</text>
      </box>
      
      {/* Reason why permission is needed (additional context) */}
      <Show when={getReason()}>
        <box paddingLeft={4}>
          <text fg={Colors.ui.dim}>Reason: {getReason()}</text>
        </box>
      </Show>
      
      <box height={1} />
      
      {/* Show patterns (file paths, commands) */}
      <Show when={props.request.patterns && props.request.patterns.length > 0}>
        <box flexDirection="column" paddingLeft={2}>
          <text fg={Colors.ui.dim}>Target:</text>
          <For each={props.request.patterns}>
            {(pattern) => (
              <box paddingLeft={2}>
                <text fg={Colors.ui.text}>{truncate(pattern, lineWidth - 12)}</text>
              </box>
            )}
          </For>
        </box>
      </Show>
      
      {/* Show working directory for bash */}
      <Show when={props.request.permission === "bash" && props.request.metadata?.["workdir"]}>
        <box paddingLeft={2}>
          <text fg={Colors.ui.dim}>Directory: {String(props.request.metadata?.["workdir"])}</text>
        </box>
      </Show>
      
      {/* Show old/new strings for edit operations */}
      <Show when={props.request.permission === "edit" && props.request.metadata?.["oldString"]}>
        <box height={1} />
        <box flexDirection="column" paddingLeft={2}>
          <text fg={Colors.ui.dim}>Change:</text>
          <box paddingLeft={2} flexDirection="column">
            <text fg={Colors.status.error}>- {truncate(String(props.request.metadata?.["oldString"]), lineWidth - 14)}</text>
            <text fg={Colors.status.success}>+ {truncate(String(props.request.metadata?.["newString"] || ""), lineWidth - 14)}</text>
          </box>
        </box>
      </Show>
      
      {/* Show content length for write operations */}
      <Show when={props.request.permission === "write" && props.request.metadata?.["contentLength"]}>
        <box paddingLeft={2}>
          <text fg={Colors.ui.dim}>Content: {String(props.request.metadata?.["contentLength"])} bytes</text>
        </box>
      </Show>
      
      <box height={1} />
      
      {/* Divider */}
      <box paddingLeft={2}>
        <text fg={Colors.ui.dim}>{dividerLine}</text>
      </box>
      
      <box height={1} />
      
      {/* Options list - radio style like QuestionOverlay */}
      <For each={options}>
        {(option, i) => {
          const isFocused = () => i() === selectedIndex();
          const indicator = () => isFocused() ? "(*)" : "( )";
          // Use different highlight colors for focused state
          const focusedFg = () => option.key === "reject" ? Colors.status.error : Colors.mode.AGENT;
          
          return (
            <box flexDirection="column" marginBottom={1} paddingLeft={2}>
              <box flexDirection="row">
                <text fg={isFocused() ? focusedFg() : Colors.ui.dim}>{indicator()}</text>
                <text fg={isFocused() ? focusedFg() : Colors.ui.text}> {option.label}</text>
                <text fg={isFocused() ? focusedFg() : Colors.ui.dim}> [{option.hotkey}]</text>
              </box>
              <text fg={Colors.ui.dim}>    {option.description}</text>
            </box>
          );
        }}
      </For>
      
      {/* Divider */}
      <box paddingLeft={2}>
        <text fg={Colors.ui.dim}>{dividerLine}</text>
      </box>
      
      {/* Hints */}
      <box paddingLeft={2}>
        <text fg={Colors.ui.dim}>↑/↓: Navigate  Enter: Confirm  1-4: Quick select  Esc: Reject</text>
      </box>
      
      <box height={1} />
    </box>
  );
}
