import { createSignal, For, Show } from "solid-js";
import { Colors } from "../design";

interface TerminalOutputProps {
  command: string;           // The command that was executed
  output: string;            // Command output (stdout + stderr)
  exitCode: number;          // Exit code (0 = success)
  workdir?: string;          // Working directory if different from cwd
  description?: string;      // Optional description
  maxPreviewLines?: number;  // Lines to show in collapsed mode (default: 5)
}

// Hard limits to prevent UI issues
const MAX_TOTAL_LINES = 100;
const MAX_CHARS = 10000;

/**
 * TerminalOutput Component
 * 
 * Displays bash command output in a terminal-like style:
 * - Shows command with $ prompt
 * - Shows output with scroll when expanded
 * - Shows exit code if non-zero
 * - Click to expand/collapse
 * 
 * Collapsed: Shows first N lines with "... N more lines"
 * Expanded: Shows all output in a scrollable area
 */
export function TerminalOutput(props: TerminalOutputProps) {
  const [expanded, setExpanded] = createSignal(false);
  
  const maxPreview = () => props.maxPreviewLines ?? 5;
  
  // Process output with safety limits
  const processedOutput = () => {
    let output = props.output;
    
    // Character limit
    if (output.length > MAX_CHARS) {
      output = output.slice(0, MAX_CHARS) + "\n... (output truncated)";
    }
    
    // Line limit
    const lines = output.split("\n");
    if (lines.length > MAX_TOTAL_LINES) {
      return {
        lines: lines.slice(0, MAX_TOTAL_LINES),
        truncated: true,
        totalLines: lines.length,
      };
    }
    
    return {
      lines,
      truncated: false,
      totalLines: lines.length,
    };
  };
  
  const previewLines = () => processedOutput().lines.slice(0, maxPreview());
  const hasMore = () => processedOutput().lines.length > maxPreview();
  const remainingLines = () => processedOutput().lines.length - maxPreview();
  const allLines = () => processedOutput().lines;
  
  // Terminal colors
  const TERMINAL_BG = "#0d0d0d";  // Near black
  const PROMPT_COLOR = Colors.status.success;  // Green for $
  const COMMAND_COLOR = Colors.ui.text;  // White for command
  const OUTPUT_COLOR = Colors.ui.dim;  // Dim for output
  
  const handleToggle = () => {
    setExpanded(!expanded());
  };
  
  // Prompt line: shows working dir if specified
  const promptPrefix = () => {
    if (props.workdir) {
      const shortDir = props.workdir.replace(process.cwd(), ".");
      return `${shortDir} $`;
    }
    return "$";
  };
  
  return (
    <box 
      flexDirection="column" 
      backgroundColor={TERMINAL_BG}
      paddingLeft={1}
      paddingRight={1}
      onMouseDown={handleToggle}
    >
      {/* Command line */}
      <box flexDirection="row">
        <text fg={PROMPT_COLOR}>{promptPrefix()} </text>
        <text fg={COMMAND_COLOR}>{props.command}</text>
      </box>
      
      {/* Output - collapsed view */}
      <Show when={!expanded()}>
        <For each={previewLines()}>
          {(line) => <text fg={OUTPUT_COLOR}>{line || " "}</text>}
        </For>
        <Show when={hasMore()}>
          <text fg={Colors.ui.dim}>... ({remainingLines()} more lines - click to expand)</text>
        </Show>
      </Show>
      
      {/* Output - expanded view in scrollbox */}
      <Show when={expanded()}>
        <scrollbox 
          height={Math.min(15, allLines().length + 1)}
          stickyScroll
          scrollbarOptions={{ visible: true }}
        >
          <box flexDirection="column">
            <For each={allLines()}>
              {(line) => <text fg={OUTPUT_COLOR}>{line || " "}</text>}
            </For>
          </box>
        </scrollbox>
        <Show when={processedOutput().truncated}>
          <text fg={Colors.status.warning}>
            (showing {MAX_TOTAL_LINES} of {processedOutput().totalLines} lines)
          </text>
        </Show>
        <text fg={Colors.ui.dim}>(click to collapse)</text>
      </Show>
      
      {/* Exit code if non-zero */}
      <Show when={props.exitCode !== 0}>
        <text fg={Colors.status.error}>Exit code: {props.exitCode}</text>
      </Show>
    </box>
  );
}
