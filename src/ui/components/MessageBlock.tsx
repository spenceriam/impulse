import { For, Show, type JSX } from "solid-js";
import { Colors, type Mode, getModeColor } from "../design";
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

// Background colors for message types (per design spec)
const USER_MESSAGE_BG = "#1a2a2a";    // Dark cyan tint for user messages
const THINKING_BG = "#1f1f1f";        // Lighter dark gray for thinking
const ASSISTANT_BG = "#141414";       // Darker gray for AI response

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
      return `file_write ${metadata.filePath} (${metadata.linesWritten} lines)`;
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

/**
 * Thinking/reasoning section
 * - Dim left border (┊) with italic "Thinking" label
 * - Max 2 lines preview, truncated with "..."
 * - Lighter background to distinguish from content
 */
function ThinkingSection(props: { content: string }) {
  // Filter out any [REDACTED] content and truncate to ~2 lines
  const content = () => {
    const cleaned = props.content.replace("[REDACTED]", "").trim();
    // Truncate to first 150 chars or 2 newlines
    const lines = cleaned.split("\n").slice(0, 2);
    let truncated = lines.join(" ").slice(0, 150);
    if (cleaned.length > truncated.length) {
      truncated += "...";
    }
    return truncated;
  };
  
  return (
    <Show when={content()}>
      <box 
        flexDirection="column" 
        marginBottom={1}
        backgroundColor={THINKING_BG}
        paddingLeft={1}
        paddingRight={1}
      >
        <box flexDirection="row">
          <text fg={Colors.ui.dim}>┊ </text>
          <text fg={Colors.ui.dim}><em>Thinking</em></text>
        </box>
        <box flexDirection="row" paddingLeft={2}>
          <text fg={Colors.ui.dim}><em>{content()}</em></text>
        </box>
      </box>
    </Show>
  );
}

/**
 * Render a single tool call with collapsible display
 * - Collapsed: shows status indicator + tool title
 * - Expanded: shows tool-specific content (command output, diff, etc.)
 * - Errors auto-expand
 */
function ToolCallDisplay(props: { toolCall: ToolCallInfo; attemptNumber?: number }) {
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

  return (
    <CollapsibleToolBlock
      status={props.toolCall.status}
      expandedContent={expandedContent()}
    >
      <text fg={Colors.ui.dim}>{title()}</text>
      <Show when={props.attemptNumber}>
        <text fg={Colors.status.warning}> (attempt {props.attemptNumber})</text>
      </Show>
    </CollapsibleToolBlock>
  );
}

export function MessageBlock(props: MessageBlockProps) {
  const parsed = () => parseMarkdown(props.message.content);

  const isUser = () => props.message.role === "user";
  const model = () => props.message.model || "GLM-4.7";
  const mode = () => props.message.mode;
  const modeColor = () => mode() ? getModeColor(mode()!) : Colors.ui.dim;
  const toolCalls = () => props.message.toolCalls ?? [];
  const reasoning = () => props.message.reasoning;

  return (
    <Show
      when={isUser()}
      fallback={
        // Assistant message - subtle dark background
        <box 
          flexDirection="column" 
          marginBottom={1}
          backgroundColor={ASSISTANT_BG}
          paddingLeft={1}
          paddingRight={1}
        >
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
          {/* Thinking/Reasoning content */}
          <Show when={reasoning()}>
            <ThinkingSection content={reasoning()!} />
          </Show>
          {/* Message content */}
          <Show when={props.message.content}>
            <box flexDirection="column">
              <For each={parsed()}>
                {(node: MarkdownNode) => renderMarkdownNode(node)}
              </For>
            </box>
          </Show>
          {/* Tool calls - tighter spacing */}
          <Show when={toolCalls().length > 0}>
            <box flexDirection="column">
              <For each={toolCalls()}>
                {(toolCall, index) => {
                  const attempt = (() => {
                    const current = toolCalls()[index()];
                    if (!current || current.status !== "error") return undefined;

                    let attempts = 1;
                    for (let i = index() - 1; i >= 0; i--) {
                      const prev = toolCalls()[i];
                      if (prev?.name === current.name && prev?.status === "error") {
                        attempts++;
                      } else {
                        break;
                      }
                    }

                    return attempts > 1 ? attempts : undefined;
                  })();

                  const displayProps: { toolCall: ToolCallInfo; attemptNumber?: number } = { toolCall };
                  if (attempt !== undefined) {
                    displayProps.attemptNumber = attempt;
                  }

                  return <ToolCallDisplay {...displayProps} />;
                }}
              </For>
            </box>
          </Show>
        </box>
      }
    >
      {/* User message - cyan left border + dark cyan background */}
      <box flexDirection="row" marginBottom={1}>
        <text fg={Colors.mode.AGENT}>┃</text>
        <box 
          flexDirection="column" 
          backgroundColor={USER_MESSAGE_BG}
          paddingLeft={1}
          paddingRight={1}
          flexGrow={1}
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
      </box>
    </Show>
  );
}
