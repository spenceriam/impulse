import { For, Show } from "solid-js";
import { Colors, type Mode, getModeColor } from "../design";
import type { ToolMetadata } from "../../types/tool-metadata";

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

/**
 * Get display info for tool call based on status
 * New subtext style: success is dim, errors are highlighted
 */
function getToolStatusDisplay(status: ToolCallInfo["status"]): { 
  prefix: string; 
  color: string; 
  showStatus: boolean;
  statusText?: string;
} {
  switch (status) {
    case "pending":
      return { prefix: "↳", color: Colors.ui.dim, showStatus: false };
    case "running":
      return { prefix: "↳", color: Colors.ui.dim, showStatus: false };
    case "success":
      // Success: very dim, no status shown (silence is golden)
      return { prefix: "↳", color: Colors.ui.dim, showStatus: false };
    case "error":
      // Error: red with X prefix, show error status
      return { prefix: "✗", color: Colors.status.error, showStatus: true, statusText: "error" };
    default:
      return { prefix: "↳", color: Colors.ui.dim, showStatus: false };
  }
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
 * Render a single tool call - subtext style
 * - Indented with ↳ prefix
 * - Dimmed for success (no status shown)
 * - Highlighted with ✗ for errors
 * - Special handling for task (subagent) calls
 */
function ToolCallDisplay(props: { toolCall: ToolCallInfo }) {
  const display = () => getToolStatusDisplay(props.toolCall.status);
  const isTask = () => props.toolCall.name === "task";
  
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
                {(toolCall) => <ToolCallDisplay toolCall={toolCall} />}
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
