import { createSignal, Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { Colors } from "../design";
import { useMode } from "../context/mode";
import type { PermissionRequest, PermissionResponse } from "../../permission";

/**
 * Option ID for navigation (5 selectable items)
 */
type OptionId = "once" | "session-exact" | "session-wildcard" | "always" | "reject";

/**
 * Permission option definition
 */
interface PermissionOption {
  id: OptionId;
  response: PermissionResponse;  // Maps to actual API response
  label: string;
  description: string;
  indent?: boolean;              // Sub-option (indented with radio button)
  isWildcard?: boolean;          // For wildcard approval
}

/**
 * PermissionPrompt Props
 */
interface PermissionPromptProps {
  request: PermissionRequest;
  onRespond: (response: PermissionResponse, message?: string, wildcard?: boolean) => void;
  onAllowAllEdits?: () => void;           // Shift+Tab handler for AUTO/AGENT/DEBUG modes
  onReadOnlyNotification?: () => void;    // Flash notification for read-only modes
}

/**
 * Read-only modes where Shift+Tab "Allow All Edits" is blocked
 */
const READ_ONLY_MODES = ["EXPLORE", "PLANNER", "PLAN-PRD"];

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
 * │    mkdir test-folder                                                 │
 * │                                                                      │
 * │       RESPONSE                  DESCRIPTION                          │
 * │                                                                      │
 * │  [ ]  Allow once                Permit this specific action only     │
 * │       Allow session                                                  │  <- Non-selectable header
 * │         ( ) This exact command  Auto-approve "mkdir test-folder"     │
 * │         ( ) All bash commands   Auto-approve any bash this session   │
 * │  [ ]  Allow always              Save to project config               │
 * │  [ ]  Reject                    Deny this action                     │
 * │                                                                      │
 * │  Up/Down: Navigate  Enter/Click: Confirm  Shift+Tab: Allow edits  Esc: Reject │
 * └──────────────────────────────────────────────────────────────────────┘
 */
export function PermissionPrompt(props: PermissionPromptProps) {
  const { mode } = useMode();
  
  // Truncate long strings for display
  const truncate = (str: string, max: number) => {
    if (str.length <= max) return str;
    return str.slice(0, max - 3) + "...";
  };

  // Build options dynamically based on permission type
  const getOptions = (): PermissionOption[] => {
    const toolName = props.request?.permission || "tool";
    const patternPreview = truncate(props.request?.patterns?.[0] || "action", 25);
    
    return [
      { id: "once", response: "once", label: "Allow once", description: "Permit this specific action only" },
      { id: "session-exact", response: "session", label: "This exact command", description: `Auto-approve "${patternPreview}"`, indent: true },
      { id: "session-wildcard", response: "session", label: `All ${toolName} commands`, description: `Auto-approve any ${toolName} this session`, indent: true, isWildcard: true },
      { id: "always", response: "always", label: "Allow always", description: "Save to project config" },
      { id: "reject", response: "reject", label: "Reject", description: "Deny this action" },
    ];
  };
  
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  
  const options = () => getOptions();
  const selected = () => options()[selectedIndex()]!;
  
  // Handle keyboard navigation
  useKeyboard((key) => {
    // Shift+Tab to allow all edits (session-scoped, file operations only)
    if (key.shift && key.name === "tab") {
      if (READ_ONLY_MODES.includes(mode())) {
        // Show flash notification for read-only modes
        props.onReadOnlyNotification?.();
        return;
      }
      // Enable allow all edits for session
      props.onAllowAllEdits?.();
      return;
    }
    
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
      props.onRespond(opt.response, undefined, opt.isWildcard);
      return;
    }
    
    // Escape to reject
    if (key.name === "escape") {
      props.onRespond("reject");
      return;
    }
    
    // Block all other keys - don't let them propagate
  });

  // Get tool display name (with fallback for safety)
  const getToolName = () => {
    return props.request?.permission || "(unknown tool)";
  };

  // Get action type label
  const getActionLabel = () => {
    switch (props.request?.permission) {
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
          
          {/* Patterns (file paths, commands, etc.) - with fallback */}
          <Show 
            when={props.request?.patterns?.length > 0}
            fallback={
              <box paddingLeft={2}>
                <text fg={Colors.status.warning}>(no action details available)</text>
              </box>
            }
          >
            <For each={props.request.patterns}>
              {(pattern) => (
                <box paddingLeft={2}>
                  <text fg={Colors.ui.text}>{truncate(pattern || "(empty)", contentWidth - 2)}</text>
                </box>
              )}
            </For>
          </Show>
        </box>
        
        {/* Show working directory for bash */}
        <Show when={props.request?.permission === "bash" && props.request?.metadata?.["workdir"]}>
          <box marginBottom={1}>
            <text fg={Colors.ui.dim}>Directory: </text>
            <text fg={Colors.ui.text}>{truncate(String(props.request?.metadata?.["workdir"]), contentWidth - 12)}</text>
          </box>
        </Show>
        
        {/* Show old/new strings for edit operations */}
        <Show when={props.request?.permission === "edit" && props.request?.metadata?.["oldString"]}>
          <box flexDirection="column" marginBottom={1}>
            <text fg={Colors.ui.dim}>Change:</text>
            <box paddingLeft={2} flexDirection="column">
              <text fg={Colors.diff.deletion}>- {truncate(String(props.request?.metadata?.["oldString"]), contentWidth - 4)}</text>
              <text fg={Colors.diff.addition}>+ {truncate(String(props.request?.metadata?.["newString"] || ""), contentWidth - 4)}</text>
            </box>
          </box>
        </Show>
        
        {/* Show content length for write operations */}
        <Show when={props.request?.permission === "write" && props.request?.metadata?.["contentLength"]}>
          <box marginBottom={1}>
            <text fg={Colors.ui.dim}>Content: </text>
            <text fg={Colors.ui.text}>{String(props.request?.metadata?.["contentLength"])} bytes</text>
          </box>
        </Show>
        
        <box height={1} />
        
        {/* Header row */}
        <box flexDirection="row">
          <text fg={Colors.ui.dim}>{"     RESPONSE".padEnd(30)}</text>
          <text fg={Colors.ui.dim}>DESCRIPTION</text>
        </box>
        
        <box height={1} />
        
        {/* Options rows with "Allow session" as visual header */}
        <For each={options()}>
          {(option, i) => {
            const isSelected = () => i() === selectedIndex();
            const isSubOption = option.indent === true;
            const isReject = option.id === "reject";
            
            // Show "Allow session" header before first sub-option
            const showSessionHeader = () => option.id === "session-exact";
            
            // Highlight color: cyan for normal options, red for reject
            const highlightBg = () => isReject ? Colors.status.error : Colors.mode.AGENT;
            
            // Click handler - select and confirm this option
            const handleClick = () => {
              props.onRespond(option.response, undefined, option.isWildcard);
            };
            
            // Checkbox/radio style based on option type
            const indicator = () => {
              if (isSubOption) {
                return isSelected() ? "(x) " : "( ) ";
              }
              return isSelected() ? "[x] " : "[ ] ";
            };
            
            return (
              <>
                {/* "Allow session" visual header (non-selectable) */}
                <Show when={showSessionHeader()}>
                  <box flexDirection="row" height={1}>
                    <text fg={Colors.ui.dim}>{"     Allow session"}</text>
                  </box>
                </Show>
                
                {/* Option row */}
                <Show
                  when={isSelected()}
                  fallback={
                    <box 
                      flexDirection="row" 
                      height={1} 
                      paddingLeft={isSubOption ? 5 : 0}
                      onMouseDown={handleClick}
                    >
                      <text fg={Colors.ui.dim}>{indicator()}</text>
                      <text fg={Colors.ui.text}>{option.label.padEnd(isSubOption ? 21 : 26)}</text>
                      <text fg={Colors.ui.dim}>{option.description}</text>
                    </box>
                  }
                >
                  <box 
                    flexDirection="row" 
                    height={1} 
                    paddingLeft={isSubOption ? 5 : 0}
                    backgroundColor={highlightBg()} 
                    onMouseDown={handleClick}
                  >
                    <text fg="#000000">{indicator()}</text>
                    <text fg="#000000">{option.label.padEnd(isSubOption ? 21 : 26)}</text>
                    <text fg="#000000">{option.description}</text>
                  </box>
                </Show>
              </>
            );
          }}
        </For>
        
        <box height={1} />
        
        {/* Hints */}
        <text fg={Colors.ui.dim}>Up/Down: Navigate  Enter/Click: Confirm  Shift+Tab: Allow edits  Esc: Reject</text>
      </box>
    </box>
  );
}
