import { createSignal, Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { Colors } from "../design";
import type { PermissionRequest, PermissionResponse } from "../../permission";

/**
 * Permission option definition
 */
interface PermissionOption {
  key: PermissionResponse;
  label: string;
  description: string;
  isWildcard?: boolean;  // For "Allow session (tool/*)" option
}

/**
 * PermissionPrompt Props
 */
interface PermissionPromptProps {
  request: PermissionRequest;
  onRespond: (response: PermissionResponse, message?: string, wildcard?: boolean) => void;
}

/**
 * PermissionPrompt Component
 * 
 * Clean, focused permission dialog showing:
 * - Tool name prominently
 * - What action is being requested
 * - Clear response options (navigate with arrows, confirm with Enter)
 * 
 * Layout:
 * ┌─ Permission Required ────────────────────────────────────────────────┐
 * │                                                                      │
 * │  Tool: bash                                                          │
 * │                                                                      │
 * │  Command:                                                            │
 * │    rm -rf node_modules                                               │
 * │                                                                      │
 * │       RESPONSE                  DESCRIPTION                          │
 * │                                                                      │
 * │  [x]  Allow once                Permit this specific action only     │
 * │  [ ]  Allow session             Auto-approve this exact pattern      │
 * │  [ ]  Allow session (bash/*)    Auto-approve all bash commands       │
 * │  [ ]  Allow always              Save to project config               │
 * │  [ ]  Reject                    Deny this action                     │
 * │                                                                      │
 * │  Up/Down: Navigate  Enter: Confirm  Esc: Reject                      │
 * └──────────────────────────────────────────────────────────────────────┘
 */
export function PermissionPrompt(props: PermissionPromptProps) {
  // Build options dynamically based on permission type
  const getOptions = (): PermissionOption[] => {
    const toolName = props.request.permission;
    return [
      { key: "once", label: "Allow once", description: "Permit this specific action only" },
      { key: "session", label: "Allow session", description: "Auto-approve this exact pattern" },
      { key: "session", label: `Allow session (${toolName}/*)`, description: `Auto-approve all ${toolName} actions`, isWildcard: true },
      { key: "always", label: "Allow always", description: "Save to project config" },
      { key: "reject", label: "Reject", description: "Deny this action" },
    ];
  };
  
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  
  const options = () => getOptions();
  const selected = () => options()[selectedIndex()]!;
  
  // Handle keyboard navigation - ONLY arrow keys and Enter
  useKeyboard((key) => {
    // Up/down to navigate options
    if (key.name === "up" || key.name === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.name === "down" || key.name === "j") {
      setSelectedIndex((i) => Math.min(options().length - 1, i + 1));
      return;
    }
    
    // Enter to confirm selection
    if (key.name === "return") {
      const opt = selected();
      props.onRespond(opt.key, undefined, opt.isWildcard);
      return;
    }
    
    // Escape to reject
    if (key.name === "escape") {
      props.onRespond("reject");
      return;
    }
    
    // Block all other keys - don't let them propagate
  });

  // Get tool display name
  const getToolName = () => {
    return props.request.permission;
  };

  // Get action type label
  const getActionLabel = () => {
    switch (props.request.permission) {
      case "edit":
        return "Edit file";
      case "write":
        return "Create file";
      case "bash":
        return "Command";
      case "task":
        return "Subagent";
      default:
        return "Action";
    }
  };

  // Truncate long strings for display
  const truncate = (str: string, max: number) => {
    if (str.length <= max) return str;
    return str.slice(0, max - 3) + "...";
  };

  // Line width for content
  const lineWidth = 76;
  const contentWidth = lineWidth - 6; // Account for padding and borders

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
        {/* Tool name - prominently displayed */}
        <box flexDirection="row" marginBottom={1}>
          <text fg={Colors.ui.dim}>Tool: </text>
          <text fg={Colors.status.warning}>{getToolName()}</text>
        </box>
        
        {/* Action details section */}
        <box flexDirection="column" marginBottom={1}>
          {/* Action type label */}
          <text fg={Colors.ui.dim}>{getActionLabel()}:</text>
          
          {/* Patterns (file paths, commands, etc.) */}
          <For each={props.request.patterns}>
            {(pattern) => (
              <box paddingLeft={2}>
                <text fg={Colors.ui.text}>{truncate(pattern, contentWidth - 2)}</text>
              </box>
            )}
          </For>
        </box>
        
        {/* Show working directory for bash */}
        <Show when={props.request.permission === "bash" && props.request.metadata?.["workdir"]}>
          <box marginBottom={1}>
            <text fg={Colors.ui.dim}>Directory: </text>
            <text fg={Colors.ui.text}>{truncate(String(props.request.metadata?.["workdir"]), contentWidth - 12)}</text>
          </box>
        </Show>
        
        {/* Show old/new strings for edit operations */}
        <Show when={props.request.permission === "edit" && props.request.metadata?.["oldString"]}>
          <box flexDirection="column" marginBottom={1}>
            <text fg={Colors.ui.dim}>Change:</text>
            <box paddingLeft={2} flexDirection="column">
              <text fg={Colors.diff.deletion}>- {truncate(String(props.request.metadata?.["oldString"]), contentWidth - 4)}</text>
              <text fg={Colors.diff.addition}>+ {truncate(String(props.request.metadata?.["newString"] || ""), contentWidth - 4)}</text>
            </box>
          </box>
        </Show>
        
        {/* Show content length for write operations */}
        <Show when={props.request.permission === "write" && props.request.metadata?.["contentLength"]}>
          <box marginBottom={1}>
            <text fg={Colors.ui.dim}>Content: </text>
            <text fg={Colors.ui.text}>{String(props.request.metadata?.["contentLength"])} bytes</text>
          </box>
        </Show>
        
        <box height={1} />
        
        {/* Header row */}
        <box flexDirection="row">
          <text fg={Colors.ui.dim}>{"     RESPONSE".padEnd(30)}</text>
          <text fg={Colors.ui.dim}>DESCRIPTION</text>
        </box>
        
        <box height={1} />
        
        {/* Options rows */}
        <For each={options()}>
          {(option, i) => {
            const isSelected = () => i() === selectedIndex();
            const checkbox = isSelected() ? "[x] " : "[ ] ";
            const labelCol = option.label.padEnd(26);
            const isReject = option.key === "reject";
            
            // Highlight color: cyan for normal options, red for reject
            const highlightBg = isReject ? Colors.status.error : Colors.mode.AGENT;
            
            return (
              <Show
                when={isSelected()}
                fallback={
                  <box flexDirection="row" height={1}>
                    <text fg={Colors.ui.dim}>{checkbox}</text>
                    <text fg={Colors.ui.text}>{labelCol}</text>
                    <text fg={Colors.ui.dim}>{option.description}</text>
                  </box>
                }
              >
                <box flexDirection="row" height={1} backgroundColor={highlightBg}>
                  <text fg="#000000">{checkbox}</text>
                  <text fg="#000000">{labelCol}</text>
                  <text fg="#000000">{option.description}</text>
                </box>
              </Show>
            );
          }}
        </For>
        
        <box height={1} />
        
        {/* Hints - simplified, no number keys */}
        <text fg={Colors.ui.dim}>Up/Down: Navigate  Enter: Confirm  Esc: Reject</text>
      </box>
    </box>
  );
}
