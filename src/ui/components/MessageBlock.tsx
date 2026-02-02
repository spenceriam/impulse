import { For, Show, type JSX } from "solid-js";
import { Colors, type Mode, getModeColor, getModeBackground } from "../design";
import type { ToolMetadata } from "../../types/tool-metadata";
import {
  isBashMetadata,
  isFileEditMetadata,
  isFileWriteMetadata,
  isFileReadMetadata,
  isGlobMetadata,
  isGrepMetadata,
  isTaskMetadata,
} from "../../types/tool-metadata";
import { CollapsibleToolBlock } from "./CollapsibleToolBlock";
import { DiffView } from "./DiffView";
import { TerminalOutput } from "./TerminalOutput";
import { ThinkingBlock } from "./ThinkingBlock";
import { BouncingDots } from "./BouncingDots";
import { useSession } from "../context/session";
import { getModelDisplayName } from "../../constants";

// Background colors for message types (per design spec)
const USER_MESSAGE_BG = "#222222";    // Subtle gray tint for user messages
const ASSISTANT_BG_FALLBACK = "#141414"; // Fallback gray for AI when no mode set

// Thin horizontal line character for accent lines (NOT half-blocks)
const THIN_LINE = "─";

/**
 * Tool call display info
 */
export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: string;
  status: "pending" | "running" | "success" | "error";
  result?: string;
  metadata?: ToolMetadata;  // Structured metadata for enhanced display
}

/**
 * Message type
 */
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;    // Thinking/reasoning content (GLM-specific)
  mode?: Mode;           // Mode used when generating (for assistant messages)
  model?: string;        // Model used (e.g., "glm-4.7")
  toolCalls?: ToolCallInfo[];  // Tool calls made in this message
  streaming?: boolean;   // Whether this message is currently being streamed
  timestamp?: number;    // Unix timestamp when message was created
}

/**
 * Props for MessageBlock component
 */
interface MessageBlockProps {
  message: Message;
  onCopy?: (content: string) => void;  // Called when user clicks to copy message
}

/**
 * Markdown node types
 */
type MarkdownNode =
  | { type: "paragraph"; content: string }
  | { type: "heading"; level: number; content: string }
  | { type: "code_block"; content: string; language: string }
  | { type: "list"; items: string[] }
  | { type: "numbered_list"; items: string[] }
  | { type: "blank" };

/**
 * Improved markdown parser
 * Supports: **bold**, `inline code`, ```code blocks```, - lists, 1. numbered lists, # headings
 */
function parseMarkdown(text: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  const lines = text.split("\n");
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeBlockContent: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Code block start/end
    if (trimmed.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = trimmed.slice(3).trim() || "text";
        codeBlockContent = [];
      } else {
        // End code block
        nodes.push({ type: "code_block", content: codeBlockContent.join("\n"), language: codeBlockLang });
        inCodeBlock = false;
        codeBlockLang = "";
        codeBlockContent = [];
      }
      continue;
    }

    // Inside code block
    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Blank line
    if (!trimmed) {
      nodes.push({ type: "blank" });
      continue;
    }

    // Heading (# ## ###)
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch && headingMatch[1] && headingMatch[2]) {
      nodes.push({ type: "heading", level: headingMatch[1].length, content: headingMatch[2] });
      continue;
    }

    // List item (- or *)
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const lastNode = nodes[nodes.length - 1];
      if (lastNode && lastNode.type === "list") {
        lastNode.items.push(trimmed.slice(2));
      } else {
        nodes.push({ type: "list", items: [trimmed.slice(2)] });
      }
      continue;
    }

    // Numbered list (1. 2. etc)
    const numberedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numberedMatch && numberedMatch[1]) {
      const lastNode = nodes[nodes.length - 1];
      if (lastNode && lastNode.type === "numbered_list") {
        lastNode.items.push(numberedMatch[1]);
      } else {
        nodes.push({ type: "numbered_list", items: [numberedMatch[1]] });
      }
      continue;
    }

    // Regular paragraph - preserve inline formatting
    nodes.push({ type: "paragraph", content: trimmed });
  }

  // Close unclosed code block
  if (inCodeBlock && codeBlockContent.length > 0) {
    nodes.push({ type: "code_block", content: codeBlockContent.join("\n"), language: codeBlockLang });
  }

  return nodes;
}

/**
 * Render inline formatting (bold, inline code) within text
 */
function renderInlineText(content: string) {
  // Parse inline formatting: **bold** and `code`
  const parts: Array<{ type: "text" | "bold" | "code"; content: string }> = [];
  let remaining = content;
  
  while (remaining.length > 0) {
    // Check for bold
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    // Check for inline code
    const codeMatch = remaining.match(/`([^`]+)`/);
    
    // Find which comes first
    const boldIndex = boldMatch ? remaining.indexOf(boldMatch[0]) : -1;
    const codeIndex = codeMatch ? remaining.indexOf(codeMatch[0]) : -1;
    
    if (boldIndex === -1 && codeIndex === -1) {
      // No more formatting
      if (remaining) parts.push({ type: "text", content: remaining });
      break;
    }
    
    // Handle whichever comes first
    if (boldIndex !== -1 && (codeIndex === -1 || boldIndex < codeIndex)) {
      if (boldIndex > 0) {
        parts.push({ type: "text", content: remaining.slice(0, boldIndex) });
      }
      const boldContent = boldMatch?.[1] ?? "";
      parts.push({ type: "bold", content: boldContent });
      remaining = remaining.slice(boldIndex + (boldMatch?.[0]?.length ?? 0));
    } else if (codeIndex !== -1) {
      if (codeIndex > 0) {
        parts.push({ type: "text", content: remaining.slice(0, codeIndex) });
      }
      const codeContent = codeMatch?.[1] ?? "";
      parts.push({ type: "code", content: codeContent });
      remaining = remaining.slice(codeIndex + (codeMatch?.[0]?.length ?? 0));
    }
  }
  
  return (
    <text>
      <For each={parts}>
        {(part) => {
          if (part.type === "bold") return <strong>{part.content}</strong>;
          if (part.type === "code") return <>`{part.content}`</>;
          return <>{part.content}</>;
        }}
      </For>
    </text>
  );
}

/**
 * Render markdown node
 */
function renderMarkdownNode(node: MarkdownNode) {
  switch (node.type) {
    case "paragraph":
      return renderInlineText(node.content);
    case "heading":
      return (
        <text>
          <strong>{node.content}</strong>
        </text>
      );
    case "code_block":
      return (
        <box marginTop={1} marginBottom={1}>
          <code
            // @ts-ignore: OpenTUI types incomplete for SolidJS
            code={node.content}
            language={node.language}
          />
        </box>
      );
    case "list":
      return (
        <box flexDirection="column">
          <For each={node.items}>
            {(item: string) => (
              <box flexDirection="row">
                <text fg={Colors.ui.dim}>  • </text>
                {renderInlineText(item)}
              </box>
            )}
          </For>
        </box>
      );
    case "numbered_list":
      return (
        <box flexDirection="column">
          <For each={node.items}>
            {(item: string, index) => (
              <box flexDirection="row">
                <text fg={Colors.ui.dim}>  {index() + 1}. </text>
                {renderInlineText(item)}
              </box>
            )}
          </For>
        </box>
      );
    case "blank":
      return <box height={1} />;
    default:
      return null;
  }
}

/**
 * Message Block Component
 * Message display with role-based styling and markdown rendering
 * 
 * Props:
 * - message: Message to display
 */

interface MessageBlockProps {
  message: Message;
}



// ============================================
// Tool-Specific Display Helpers
// ============================================

/**
 * Generate title text for a tool call based on its metadata
 */
function getToolTitle(name: string, args: string, metadata?: ToolMetadata): string {
  // Use metadata if available
  if (metadata) {
    if (isBashMetadata(metadata)) {
      const desc = metadata.description || metadata.command.slice(0, 40);
      return `bash "${desc.length > 40 ? desc.slice(0, 37) + "..." : desc}"`;
    }

    if (isFileWriteMetadata(metadata)) {
      const createdStr = metadata.created ? " (created)" : "";
      return `file_write ${metadata.filePath} (${metadata.linesWritten} lines)${createdStr}`;
    }

    if (isFileEditMetadata(metadata)) {
      return `file_edit ${metadata.filePath} (+${metadata.linesAdded}/-${metadata.linesRemoved})`;
    }

    if (isFileReadMetadata(metadata)) {
      const truncStr = metadata.truncated ? ", truncated" : "";
      return `file_read ${metadata.filePath} (${metadata.linesRead} lines${truncStr})`;
    }

    if (isGlobMetadata(metadata)) {
      const pathStr = metadata.path ? ` in ${metadata.path}` : "";
      return `glob "${metadata.pattern}"${pathStr} (${metadata.matchCount} matches)`;
    }

    if (isGrepMetadata(metadata)) {
      const pathStr = metadata.path ? ` in ${metadata.path}` : "";
      return `grep "${metadata.pattern}"${pathStr} (${metadata.matchCount} matches)`;
    }

    if (isTaskMetadata(metadata)) {
      return `task [${metadata.subagentType}] "${metadata.description}"`;
    }
  }

  // Fallback: parse from arguments
  try {
    const parsed = JSON.parse(args || "{}");

    if (name === "bash") {
      const desc = parsed.description || parsed.command?.slice(0, 40) || "";
      return `bash "${desc}"`;
    }

    // Common path-based tools
    const pathKeys = ["path", "filePath", "file"];
    for (const key of pathKeys) {
      if (parsed[key]) {
        const val = String(parsed[key]);
        return `${name} ${val.length > 40 ? val.slice(0, 37) + "..." : val}`;
      }
    }

    // Pattern-based tools
    if (parsed.pattern) {
      return `${name} "${parsed.pattern}"`;
    }

    // Task tool
    if (name === "task" && parsed.subagent_type) {
      return `task [${parsed.subagent_type}] "${parsed.description || ""}"`;
    }
  } catch {
    // Ignore parse errors
  }

  return name;
}

/**
 * Generate expanded content for a tool call based on its metadata
 * Returns null if no expanded content available
 */
function getExpandedContent(
  _name: string,
  metadata?: ToolMetadata,
  _result?: string,
  status?: "pending" | "running" | "success" | "error"
): JSX.Element | null {
  if (!metadata) return null;

  // Bash: use TerminalOutput component for proper terminal-style display
  if (isBashMetadata(metadata)) {
    // Build props conditionally to avoid passing undefined
    const terminalProps: {
      command: string;
      output: string;
      exitCode: number;
      maxPreviewLines: number;
      workdir?: string;
      description?: string;
    } = {
      command: metadata.command,
      output: metadata.output,
      exitCode: metadata.exitCode,
      maxPreviewLines: 5,
    };
    if (metadata.workdir) terminalProps.workdir = metadata.workdir;
    if (metadata.description) terminalProps.description = metadata.description;
    
    return <TerminalOutput {...terminalProps} />;
  }

  // File Edit: show diff or fallback
  if (isFileEditMetadata(metadata)) {
    if (metadata.diff && metadata.diff.length > 0) {
      return <DiffView diff={metadata.diff} maxLines={30} />;
    }
    if (metadata.diffSkipped) {
      return (
        <text fg={Colors.ui.dim}>
          Diff omitted ({metadata.diffReason ?? "file too large"}).
        </text>
      );
    }
  }
  
  // File Write: show diff (for new files, shows all lines as additions)
  if (isFileWriteMetadata(metadata)) {
    if (metadata.diff && metadata.diff.length > 0) {
      return <DiffView diff={metadata.diff} maxLines={30} isNewFile={metadata.created} />;
    }
    if (metadata.diffSkipped) {
      return (
        <text fg={Colors.ui.dim}>
          Diff omitted ({metadata.diffReason ?? "file too large"}).
        </text>
      );
    }
  }

  // Task: show action summaries (or in-progress placeholder)
  if (isTaskMetadata(metadata)) {
    const isActive = status === "pending" || status === "running";
    return (
      <box flexDirection="column">
        <text fg={Colors.ui.dim}>({metadata.toolCallCount} tool calls)</text>
        <Show when={metadata.actions.length > 0} fallback={
          <box flexDirection="row">
            <text fg={Colors.ui.dim}>└─ </text>
            <Show when={isActive} fallback={<text fg={Colors.ui.dim}>No actions recorded.</text>}>
              <text fg={Colors.ui.dim}>In progress </text>
              <BouncingDots color={Colors.ui.dim} />
            </Show>
          </box>
        }>
          <For each={metadata.actions}>
            {(action) => (
              <text fg={Colors.ui.dim}>└─ {action}</text>
            )}
          </For>
        </Show>
      </box>
    );
  }

  // No expanded content for other tools
  return null;
}

// ThinkingSection removed - now using ThinkingBlock component

// ============================================
// Activity Status Grouping
// ============================================

/**
 * Activity categories for grouping tool calls
 */
/**
 * Get activity status label for a specific tool
 * Returns singular form - caller can pluralize if needed
 */
function getToolActivityLabel(name: string): string {
  switch (name) {
    // File operations
    case "file_read":
      return "Reading file...";
    case "file_write":
      return "Writing file...";
    case "file_edit":
      return "Editing file...";
    
    // Search operations
    case "glob":
      return "Finding files...";
    case "grep":
      return "Searching...";
    case "tool_docs":
      return "Loading tool docs...";
    
    // Execution
    case "bash":
      return "Running command...";
    case "task":
      return "Running subagent...";
    
    // Todo operations
    case "todo_write":
      return "Planning...";
    case "todo_read":
      return "Reading todos...";
    
    // UI/session tools
    case "set_header":
      return "Updating header...";
    case "set_mode":
      return "Switching mode...";
    
    // Question tool
    case "question":
      return "Asking question...";
    
    // MCP tools
    case "webSearchPrime":
      return "Searching web...";
    case "webReader":
      return "Reading webpage...";
    case "search_doc":
    case "get_repo_structure":
    case "read_file":
      return "Querying docs...";
    case "ui_to_artifact":
    case "extract_text_from_screenshot":
    case "diagnose_error_screenshot":
    case "understand_technical_diagram":
    case "analyze_data_visualization":
    case "ui_diff_check":
    case "image_analysis":
    case "video_analysis":
      return "Analyzing image...";
    case "resolve-library-id":
    case "query-docs":
      return "Querying Context7...";
    
    default:
      // Generic MCP tool
      if (name.startsWith("mcp_")) {
        return "Using external tool...";
      }
      return "Working...";
  }
}

/**
 * Check if a tool is an MCP tool
 */
function isMCPTool(name: string): boolean {
  return name.startsWith("mcp_") || 
    ["webSearchPrime", "webReader", "search_doc", "get_repo_structure", "read_file",
     "ui_to_artifact", "extract_text_from_screenshot", "diagnose_error_screenshot",
     "understand_technical_diagram", "analyze_data_visualization", "ui_diff_check",
     "image_analysis", "video_analysis", "resolve-library-id", "query-docs"].includes(name);
}

/**
 * Get MCP server name from tool name for display
 */
function getMCPServerName(toolName: string): string {
  // Map known MCP tools to their server names
  const toolToServer: Record<string, string> = {
    webSearchPrime: "Web Search",
    webReader: "Web Reader",
    search_doc: "Zread",
    get_repo_structure: "Zread",
    read_file: "Zread",
    ui_to_artifact: "Vision",
    extract_text_from_screenshot: "Vision",
    diagnose_error_screenshot: "Vision",
    understand_technical_diagram: "Vision",
    analyze_data_visualization: "Vision",
    ui_diff_check: "Vision",
    image_analysis: "Vision",
    video_analysis: "Vision",
    "resolve-library-id": "Context7",
    "query-docs": "Context7",
  };
  
  return toolToServer[toolName] || "MCP";
}

/**
 * Get the current activity label for running tool calls
 * Returns the label for the first running/pending tool, or empty if none
 */
function getCurrentActivityLabel(toolCalls: ToolCallInfo[]): string {
  const runningTool = toolCalls.find(tc => tc.status === "pending" || tc.status === "running");
  if (!runningTool) return "";
  
  // For MCP tools, show server name
  if (isMCPTool(runningTool.name)) {
    return `Using ${getMCPServerName(runningTool.name)} (MCP)...`;
  }
  
  return getToolActivityLabel(runningTool.name);
}

/**
 * Check if a tool is read-only (should be shown as minimal one-liner)
 */
function isReadOnlyTool(name: string): boolean {
  return ["file_read", "glob", "grep", "tool_docs"].includes(name);
}

/**
 * Minimal one-liner display for read-only tools (file_read, glob, grep)
 * Shows dim status indicator + title, no expand option
 */
function ReadOnlyToolDisplay(props: { toolCall: ToolCallInfo }): JSX.Element {
  const title = () => getToolTitle(
    props.toolCall.name,
    props.toolCall.arguments,
    props.toolCall.metadata
  );
  
  const status = () => props.toolCall.status;
  
  // Status indicator: ~ running, checkmark success, x error
  const statusIndicator = () => {
    switch (status()) {
      case "pending":
      case "running":
        return "~";
      case "success":
        return "\u2713"; // checkmark
      case "error":
        return "\u2717"; // x mark
      default:
        return " ";
    }
  };
  
  const statusColor = () => {
    switch (status()) {
      case "pending":
      case "running":
        return Colors.ui.primary;
      case "success":
        return Colors.ui.dim;
      case "error":
        return Colors.status.error;
      default:
        return Colors.ui.dim;
    }
  };
  
  return (
    <box flexDirection="row" height={1}>
      <text fg={statusColor()}>{statusIndicator()} </text>
      <text fg={Colors.ui.dim}>{title()}</text>
    </box>
  );
}

/**
 * Render a single tool call with inline summary display (Option A)
 * 
 * Display modes:
 * - Read-only tools (file_read, glob, grep): Minimal one-liner, no expand
 * - Running/Pending: Shows `~ tool_title` with running indicator
 * - Success: Shows `✓ tool_title` as compact one-liner (expandable if has content)
 * - Error: Shows `✗ tool_title` auto-expanded with error details
 * - Verbose mode: All tools default expanded
 */
function ToolCallDisplay(props: { toolCall: ToolCallInfo; attemptNumber?: number; verbose?: boolean }): JSX.Element {
  // Read-only tools get minimal display (unless in verbose mode)
  if (isReadOnlyTool(props.toolCall.name) && !props.verbose) {
    return <ReadOnlyToolDisplay toolCall={props.toolCall} />;
  }
  
  const title = () => getToolTitle(
    props.toolCall.name,
    props.toolCall.arguments,
    props.toolCall.metadata
  );

  const expandedContent = () => getExpandedContent(
    props.toolCall.name,
    props.toolCall.metadata,
    props.toolCall.result,
    props.toolCall.status
  );

  const status = () => props.toolCall.status;
  const isRunning = () => status() === "pending" || status() === "running";
  
  // In verbose mode, default to expanded
  // For errors, auto-expand
  // For file modifications (write/edit), auto-expand to show diff
  // For other success cases, default to collapsed (compact inline summary)
  const defaultExpanded = () => {
    if (props.verbose === true) return true;
    if (isRunning() && props.toolCall.name === "task") return true;
    if (status() === "error") return true;
    // Auto-expand file modifications to show DiffView
    if (status() === "success" && ["file_write", "file_edit"].includes(props.toolCall.name)) {
      return true;
    }
    return false; // Other success cases = collapsed by default
  };

  // For successful completions without meaningful expanded content, 
  // don't show the expand indicator at all (truly inline)
  const hasExpandableContent = () => !!expandedContent();

  return (
    <CollapsibleToolBlock
      status={props.toolCall.status}
      expandedContent={hasExpandableContent() ? expandedContent() : undefined}
      defaultExpanded={defaultExpanded()}
    >
      <text fg={Colors.ui.dim}>{title()}</text>
      <Show when={props.attemptNumber}>
        <text fg={Colors.status.warning}> (attempt {props.attemptNumber})</text>
      </Show>
    </CollapsibleToolBlock>
  );
}

export function MessageBlock(props: MessageBlockProps) {
  // Handle click to copy message content
  const handleCopy = () => {
    if (props.message.content && props.onCopy) {
      props.onCopy(props.message.content);
    }
  };
  // Access session context for verbose setting
  const { verboseTools } = useSession();
  
  const parsed = () => parseMarkdown(props.message.content);

  const isUser = () => props.message.role === "user";
  const model = () => props.message.model || "GLM-4.7";
  const mode = () => props.message.mode;
  // AI messages use mode color; default to AUTO's color (soft white) if no mode set
  const modeColor = () => mode() ? getModeColor(mode()!) : Colors.mode.AUTO;
  const toolCalls = () => props.message.toolCalls ?? [];
  const reasoning = () => props.message.reasoning;
  const isStreaming = () => props.message.streaming ?? false;

  const toolEntries = () => toolCalls().map((toolCall, index) => ({ toolCall, index }));
  const activeToolEntries = () =>
    toolEntries().filter(({ toolCall }) => toolCall.status === "pending" || toolCall.status === "running");
  const errorToolEntries = () =>
    toolEntries().filter(({ toolCall }) => toolCall.status === "error");
  const getAttemptNumber = (index: number) => {
    const allToolCalls = toolCalls();
    const current = allToolCalls[index];
    if (!current || current.status !== "error") return undefined;

    let attempts = 1;
    for (let i = index - 1; i >= 0; i--) {
      const prev = allToolCalls[i];
      if (prev?.name === current.name && prev?.status === "error") {
        attempts++;
      } else {
        break;
      }
    }

    return attempts > 1 ? attempts : undefined;
  };
  
  // User accent color is gray (dim) - distinct from mode-colored AI messages
  const userAccentColor = Colors.ui.dim;
  
  // AI message background color - mode-specific dim tint for visual distinction
  const aiBackground = () => mode() ? getModeBackground(mode()!) : ASSISTANT_BG_FALLBACK;
  
  // Format timestamp for display (e.g., "12:34 PM")
  const formattedTime = () => {
    const ts = props.message.timestamp;
    if (!ts) return "";
    const date = new Date(ts);
    return date.toLocaleTimeString("en-US", { 
      hour: "numeric", 
      minute: "2-digit", 
      hour12: true 
    });
  };

  return (
    <Show
      when={isUser()}
      fallback={
        // Assistant message with mode-colored thin accent lines and tinted background
        // Background applied to outer container so it encompasses accent lines
        <box 
          flexDirection="column" 
          marginBottom={1}
          width="100%"
          minWidth={0}
          overflow="hidden"
          backgroundColor={aiBackground()}
        >
          {/* Top accent line - mode colored, thin horizontal line */}
          <box height={1} width="100%" overflow="hidden">
            <text fg={modeColor()}>{THIN_LINE.repeat(500)}</text>
          </box>
          
          {/* Message content area - clickable to copy */}
          <box 
            flexDirection="column"
            paddingLeft={1}
            paddingRight={1}
            width="100%"
            minWidth={0}
            overflow="hidden"
            onMouseDown={handleCopy}
          >
            {/* Header: Model [MODE] */}
            <box flexDirection="row">
              <text>
                <strong>{getModelDisplayName(model())}</strong>
              </text>
              <Show when={mode()}>
                <text fg={Colors.ui.dim}> [</text>
                <text fg={modeColor()}>{mode()}</text>
                <text fg={Colors.ui.dim}>]</text>
              </Show>
            </box>
            
            {/* Bouncing dots during initial processing (before content/reasoning arrives) */}
            <Show when={isStreaming() && !props.message.content && !reasoning()}>
              <box flexDirection="row" marginTop={1}>
                <text fg={Colors.ui.dim}>Thinking </text>
                <BouncingDots color={modeColor()} />
              </box>
            </Show>
            
            {/* Thinking/Reasoning content - collapsible block */}
            <Show when={reasoning()}>
              <ThinkingBlock content={reasoning()!} streaming={isStreaming()} mode={mode()} />
            </Show>
            
            {/* Message content - custom markdown parser */}
            <Show when={props.message.content}>
              <box flexDirection="column" marginTop={1}>
                <For each={parsed()}>
                  {(node: MarkdownNode) => renderMarkdownNode(node)}
                </For>
              </box>
            </Show>
            
            {/* Tool calls with activity label */}
            <Show when={toolCalls().length > 0}>
              <box flexDirection="column" marginTop={1}>
                {/* Activity status label (only when a tool is running) */}
                <Show when={getCurrentActivityLabel(toolCalls())}>
                  <box flexDirection="row" marginBottom={1}>
                    <text fg={Colors.ui.primary}>
                      {getCurrentActivityLabel(toolCalls())}
                    </text>
                  </box>
                </Show>

                <Show
                  when={!verboseTools()}
                  fallback={
                    <For each={toolCalls()}>
                      {(toolCall, index) => {
                        const attempt = getAttemptNumber(index());

                        const displayProps: { toolCall: ToolCallInfo; attemptNumber?: number; verbose?: boolean } = {
                          toolCall,
                          verbose: true,
                        };
                        if (attempt !== undefined) {
                          displayProps.attemptNumber = attempt;
                        }

                        return <ToolCallDisplay {...displayProps} />;
                      }}
                    </For>
                  }
                >
                  {/* Active tool calls (pending/running) */}
                  <For each={activeToolEntries()}>
                    {(entry) => {
                      const displayProps: { toolCall: ToolCallInfo; attemptNumber?: number; verbose?: boolean } = {
                        toolCall: entry.toolCall,
                        verbose: false,
                      };
                      return <ToolCallDisplay {...displayProps} />;
                    }}
                  </For>

                  {/* Error tool calls (always visible) */}
                  <For each={errorToolEntries()}>
                    {(entry) => {
                      const attempt = getAttemptNumber(entry.index);
                      const displayProps: { toolCall: ToolCallInfo; attemptNumber?: number; verbose?: boolean } = {
                        toolCall: entry.toolCall,
                        verbose: false,
                      };
                      if (attempt !== undefined) {
                        displayProps.attemptNumber = attempt;
                      }
                      return <ToolCallDisplay {...displayProps} />;
                    }}
                  </For>
                </Show>
              </box>
            </Show>
            
            {/* Turn footer - only show when not streaming */}
            <Show when={!isStreaming()}>
              <box 
                flexDirection="row" 
                justifyContent="flex-end" 
                marginTop={1}
                paddingRight={1}
              >
                <text fg={Colors.ui.dim}>{getModelDisplayName(model())}</text>
                <Show when={mode()}>
                  <text fg={Colors.ui.dim}>{" | "}</text>
                  <text fg={modeColor()}>{mode()}</text>
                </Show>
                <Show when={formattedTime()}>
                  <text fg={Colors.ui.dim}>{` | ${formattedTime()}`}</text>
                </Show>
              </box>
            </Show>
          </box>
          
          {/* Bottom accent line - mode colored, thin horizontal line */}
          <box height={1} width="100%" overflow="hidden">
            <text fg={modeColor()}>{THIN_LINE.repeat(500)}</text>
          </box>
        </box>
      }
    >
      {/* User message with gray thin accent lines */}
      {/* Background applied to outer container so it encompasses accent lines */}
      <box 
        flexDirection="column" 
        marginBottom={1} 
        width="100%" 
        minWidth={0} 
        overflow="hidden"
        backgroundColor={USER_MESSAGE_BG}
      >
        {/* Top accent line - gray, thin horizontal line */}
        <box height={1} width="100%" overflow="hidden">
          <text fg={userAccentColor}>{THIN_LINE.repeat(500)}</text>
        </box>
        
        {/* Message content area - clickable to copy */}
        <box 
          flexDirection="column" 
          paddingLeft={1}
          paddingRight={1}
          width="100%"
          minWidth={0}
          overflow="hidden"
          onMouseDown={handleCopy}
        >
          <box flexDirection="row">
            <text>
              <strong>You</strong>
            </text>
          </box>
          <Show when={props.message.content}>
            <box flexDirection="column">
              <For each={parsed()}>
                {(node: MarkdownNode) => renderMarkdownNode(node)}
              </For>
            </box>
          </Show>
        </box>
        
        {/* Bottom accent line - gray, thin horizontal line */}
        <box height={1} width="100%" overflow="hidden">
          <text fg={userAccentColor}>{THIN_LINE.repeat(500)}</text>
        </box>
      </box>
    </Show>
  );
}
