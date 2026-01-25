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
import { ThinkingBlock } from "./ThinkingBlock";
import { BouncingDots } from "./BouncingDots";
import { useSession } from "../context/session";

// Background colors for message types (per design spec)
const USER_MESSAGE_BG = "#1a2a2a";    // Dark cyan tint for user messages
const ASSISTANT_BG_FALLBACK = "#141414"; // Fallback gray for AI when no mode set

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
  _result?: string
): JSX.Element | null {
  if (!metadata) return null;

  // Bash: show command and output with truncation safety
  if (isBashMetadata(metadata)) {
    // Hard limits to prevent UI crash
    const MAX_LINES = 50;
    const MAX_CHARS = 5000;

    let output = metadata.output;
    let charTruncated = false;

    // Truncate by characters first
    if (output.length > MAX_CHARS) {
      output = output.slice(0, MAX_CHARS);
      charTruncated = true;
    }

    const outputLines = output.split("\n");
    const previewLines = outputLines.slice(0, 3);
    const hasMore = outputLines.length > 3 || charTruncated;
    const moreCount = Math.min(outputLines.length - 3, MAX_LINES - 3);

    return (
      <box flexDirection="column">
        <text fg={Colors.ui.text}>$ {metadata.command}</text>
        <For each={previewLines}>
          {(line) => <text fg={Colors.ui.dim}>{line}</text>}
        </For>
        <Show when={hasMore}>
          <text fg={Colors.ui.dim}>
            ... ({charTruncated ? "output truncated" : `${moreCount} more lines`})
          </text>
        </Show>
        <Show when={metadata.exitCode !== 0}>
          <text fg={Colors.status.error}>Exit code: {metadata.exitCode}</text>
        </Show>
      </box>
    );
  }

  // File Edit: show diff
  if (isFileEditMetadata(metadata) && metadata.diff) {
    return <DiffView diff={metadata.diff} maxLines={30} />;
  }

  // Task: show action summaries
  if (isTaskMetadata(metadata) && metadata.actions.length > 0) {
    return (
      <box flexDirection="column">
        <text fg={Colors.ui.dim}>({metadata.toolCallCount} tool calls)</text>
        <For each={metadata.actions}>
          {(action) => (
            <text fg={Colors.ui.dim}>└─ {action}</text>
          )}
        </For>
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
type ActivityCategory = "reading" | "editing" | "mcp" | "questions" | "other";

/**
 * Get activity category for a tool call
 */
function getActivityCategory(name: string): ActivityCategory {
  // Reading/reviewing tools
  if (["file_read", "glob", "grep"].includes(name)) {
    return "reading";
  }
  
  // Editing/writing tools
  if (["file_write", "file_edit", "bash"].includes(name)) {
    return "editing";
  }
  
  // Question tool
  if (name === "question") {
    return "questions";
  }
  
  // MCP tools (start with mcp_ or are known MCP tool names)
  if (name.startsWith("mcp_") || 
      ["webSearchPrime", "webReader", "search_doc", "get_repo_structure", "read_file",
       "ui_to_artifact", "extract_text_from_screenshot", "diagnose_error_screenshot",
       "understand_technical_diagram", "analyze_data_visualization", "ui_diff_check",
       "image_analysis", "video_analysis", "resolve-library-id", "query-docs"].includes(name)) {
    return "mcp";
  }
  
  return "other";
}

/**
 * Get activity status label based on category and status
 */
function getActivityLabel(category: ActivityCategory, hasRunning: boolean): string {
  if (!hasRunning) return ""; // No label when all done
  
  switch (category) {
    case "reading":
      return "Reviewing documents...";
    case "editing":
      return "Editing documents...";
    case "mcp":
      return "Using external tools...";
    case "questions":
      return "Clarifying with questions...";
    default:
      return "";
  }
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
 * Group tool calls by activity category
 */
interface ToolCallGroup {
  category: ActivityCategory;
  toolCalls: Array<{ toolCall: ToolCallInfo; index: number }>;
  hasRunning: boolean;
}

function groupToolCalls(toolCalls: ToolCallInfo[]): ToolCallGroup[] {
  const groups = new Map<ActivityCategory, ToolCallGroup>();
  const categoryOrder: ActivityCategory[] = ["reading", "editing", "mcp", "questions", "other"];
  
  toolCalls.forEach((toolCall, index) => {
    const category = getActivityCategory(toolCall.name);
    
    if (!groups.has(category)) {
      groups.set(category, {
        category,
        toolCalls: [],
        hasRunning: false,
      });
    }
    
    const group = groups.get(category)!;
    group.toolCalls.push({ toolCall, index });
    
    if (toolCall.status === "pending" || toolCall.status === "running") {
      group.hasRunning = true;
    }
  });
  
  // Return groups in consistent order
  return categoryOrder
    .filter(cat => groups.has(cat))
    .map(cat => groups.get(cat)!);
}

/**
 * Render a single tool call with inline summary display (Option A)
 * 
 * Display modes:
 * - Running/Pending: Shows `~ tool_title` with running indicator
 * - Success: Shows `✓ tool_title` as compact one-liner (expandable if has content)
 * - Error: Shows `✗ tool_title` auto-expanded with error details
 * - Verbose mode: All tools default expanded
 */
function ToolCallDisplay(props: { toolCall: ToolCallInfo; attemptNumber?: number; verbose?: boolean }): JSX.Element {
  const title = () => getToolTitle(
    props.toolCall.name,
    props.toolCall.arguments,
    props.toolCall.metadata
  );

  const expandedContent = () => getExpandedContent(
    props.toolCall.name,
    props.toolCall.metadata,
    props.toolCall.result
  );

  const status = () => props.toolCall.status;
  const isRunning = () => status() === "pending" || status() === "running";
  
  // In verbose mode, default to expanded
  // For errors, auto-expand
  // For success, default to collapsed (compact inline summary)
  const defaultExpanded = () => {
    if (props.verbose === true) return true;
    if (status() === "error") return true;
    return false; // Success = collapsed by default
  };

  // For successful completions without meaningful expanded content, 
  // don't show the expand indicator at all (truly inline)
  const hasExpandableContent = () => {
    if (isRunning()) return false; // No expand while running
    return !!expandedContent();
  };

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

// Thin accent line character (half-height block)
const THIN_LINE = "─";

export function MessageBlock(props: MessageBlockProps) {
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
  
  // User accent color is gray (dim) - distinct from mode-colored AI messages
  const userAccentColor = Colors.ui.dim;
  
  // AI message background color - mode-specific dim tint for visual distinction
  const aiBackground = () => mode() ? getModeBackground(mode()!) : ASSISTANT_BG_FALLBACK;

  return (
    <Show
      when={isUser()}
      fallback={
        // Assistant message with mode-colored thin accent lines and tinted background
        <box 
          flexDirection="column" 
          marginBottom={1}
          width="100%"
          minWidth={0}
          overflow="hidden"
        >
          {/* Top accent line - mode colored */}
          <box height={1} width="100%" overflow="hidden">
            <text fg={modeColor()}>{THIN_LINE.repeat(200)}</text>
          </box>
          
          {/* Message content area with mode-tinted background */}
          <box 
            flexDirection="column"
            backgroundColor={aiBackground()}
            paddingLeft={1}
            paddingRight={1}
            width="100%"
            minWidth={0}
            overflow="hidden"
          >
            {/* Header: Model [MODE] */}
            <box flexDirection="row">
              <text>
                <strong>{model().toUpperCase()}</strong>
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
              <ThinkingBlock content={reasoning()!} streaming={isStreaming()} />
            </Show>
            
            {/* Message content */}
            <Show when={props.message.content}>
              <box flexDirection="column">
                <For each={parsed()}>
                  {(node: MarkdownNode) => renderMarkdownNode(node)}
                </For>
              </box>
            </Show>
            
            {/* Tool calls - grouped by activity type */}
            <Show when={toolCalls().length > 0}>
              <box flexDirection="column">
                <For each={groupToolCalls(toolCalls())}>
                  {(group) => (
                    <box flexDirection="column" marginTop={1}>
                      {/* Activity status label (only when running) */}
                      <Show when={group.hasRunning && getActivityLabel(group.category, group.hasRunning)}>
                        <box flexDirection="row" marginBottom={1}>
                          <text fg={Colors.ui.primary}>
                            {group.category === "mcp" 
                              ? `Using ${getMCPServerName(group.toolCalls[0]?.toolCall.name || "")} (MCP)...`
                              : getActivityLabel(group.category, group.hasRunning)}
                          </text>
                        </box>
                      </Show>
                      
                      {/* Tool calls in this group */}
                      <For each={group.toolCalls}>
                        {({ toolCall, index }) => {
                          const attempt = (() => {
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
                          })();

                          const displayProps: { toolCall: ToolCallInfo; attemptNumber?: number; verbose?: boolean } = { 
                            toolCall,
                            verbose: verboseTools(),
                          };
                          if (attempt !== undefined) {
                            displayProps.attemptNumber = attempt;
                          }

                          return <ToolCallDisplay {...displayProps} />;
                        }}
                      </For>
                    </box>
                  )}
                </For>
              </box>
            </Show>
          </box>
          
          {/* Bottom accent line - mode colored */}
          <box height={1} width="100%" overflow="hidden">
            <text fg={modeColor()}>{THIN_LINE.repeat(200)}</text>
          </box>
        </box>
      }
    >
      {/* User message with cyan thin accent lines */}
      <box 
        flexDirection="column" 
        marginBottom={1} 
        width="100%" 
        minWidth={0} 
        overflow="hidden"
      >
        {/* Top accent line - cyan */}
        <box height={1} width="100%" overflow="hidden">
          <text fg={userAccentColor}>{THIN_LINE.repeat(200)}</text>
        </box>
        
        {/* Message content area */}
        <box 
          flexDirection="column" 
          backgroundColor={USER_MESSAGE_BG}
          paddingLeft={1}
          paddingRight={1}
          width="100%"
          minWidth={0}
          overflow="hidden"
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
        
        {/* Bottom accent line - cyan */}
        <box height={1} width="100%" overflow="hidden">
          <text fg={userAccentColor}>{THIN_LINE.repeat(200)}</text>
        </box>
      </box>
    </Show>
  );
}
