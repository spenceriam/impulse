import { For, Show, createSignal } from "solid-js";
import { Colors, type Mode, getModeColor, Indicators } from "../design";

/**
 * Tool call display info
 */
export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: string;
  status: "pending" | "running" | "success" | "error";
  result?: string;
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
  | { type: "text"; content: string }
  | { type: "bold"; content: string }
  | { type: "code"; content: string; language: string }
  | { type: "list"; items: string[] };

/**
 * Simple markdown parser
 * Supports: **bold**, `code`, - lists
 */
function parseMarkdown(text: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  const lines = text.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Code block
    if (trimmed.startsWith("```")) {
      const parts = trimmed.split(" ");
      const language = parts[1]?.trim() || "text";
      nodes.push({ type: "code", content: "", language });
      continue;
    }

    // List item
    if (trimmed.startsWith("- ")) {
      const lastNode = nodes[nodes.length - 1];
      if (lastNode && lastNode.type === "list") {
        lastNode.items.push(trimmed.slice(2));
      } else {
        nodes.push({ type: "list", items: [trimmed.slice(2)] });
      }
      continue;
    }

    // Bold text (**text**)
    const boldMatch = trimmed.match(/\*\*(.*?)\*\*/);
    if (boldMatch && boldMatch[1]) {
      nodes.push({ type: "bold", content: boldMatch[1] });
      continue;
    }

    // Inline code (`code`)
    const codeMatch = trimmed.match(/`(.*?)`/);
    if (codeMatch && codeMatch[1]) {
      nodes.push({ type: "code", content: codeMatch[1], language: "text" });
      continue;
    }

    // Plain text
    nodes.push({ type: "text", content: line });
  }

  return nodes;
}

/**
 * Render markdown node
 */
function renderMarkdownNode(node: MarkdownNode) {
  switch (node.type) {
    case "text":
      return <text>{node.content}</text>;
    case "bold":
      return (
        <text>
          <strong>{node.content}</strong>
        </text>
      );
    case "code":
      return (
        <code
          // @ts-ignore: OpenTUI types incomplete for SolidJS
          code={node.content}
          language={node.language}
        />
      );
    case "list":
      return (
        <box flexDirection="column">
          <For each={node.items}>
            {(item: string) => (
              <box flexDirection="row">
                <text fg={Colors.ui.dim}>• </text>
                <text>{item}</text>
              </box>
            )}
          </For>
        </box>
      );
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
 * Get status indicator and color for tool call
 */
function getToolStatusDisplay(status: ToolCallInfo["status"]): { indicator: string; color: string } {
  switch (status) {
    case "pending":
      return { indicator: Indicators.tool.pending, color: Colors.ui.dim };
    case "running":
      return { indicator: Indicators.tool.running, color: Colors.mode.AGENT };
    case "success":
      return { indicator: Indicators.tool.success, color: Colors.status.success };
    case "error":
      return { indicator: Indicators.tool.error, color: Colors.status.error };
    default:
      return { indicator: Indicators.tool.pending, color: Colors.ui.dim };
  }
}

/**
 * Collapsible thinking/reasoning section
 * - Italics text
 * - 5-row max height with scrolling when expanded
 * - Click to toggle collapse state
 */
function ThinkingSection(props: { content: string }) {
  const [expanded, setExpanded] = createSignal(false);
  
  const toggle = () => setExpanded(prev => !prev);
  const indicator = () => expanded() ? Indicators.expanded : Indicators.collapsed;
  
  return (
    <box flexDirection="column" marginBottom={1}>
      <box 
        flexDirection="row" 
        onMouseDown={toggle}
      >
        <text fg={Colors.ui.dim}>{indicator()} </text>
        <text fg={Colors.ui.dim}><em>Thinking</em></text>
      </box>
      <Show when={expanded()}>
        <box paddingLeft={2}>
          <scrollbox height={5}>
            <text fg={Colors.ui.dim}><em>{props.content}</em></text>
          </scrollbox>
        </box>
      </Show>
    </box>
  );
}

/**
 * Render a single tool call
 */
function ToolCallDisplay(props: { toolCall: ToolCallInfo }) {
  const statusDisplay = () => getToolStatusDisplay(props.toolCall.status);
  
  return (
    <box flexDirection="column" marginBottom={1}>
      <box flexDirection="row">
        <text fg={statusDisplay().color}>{statusDisplay().indicator} </text>
        <text fg={Colors.mode.AGENT}>{props.toolCall.name}</text>
        <Show when={props.toolCall.status === "success" || props.toolCall.status === "error"}>
          <text fg={Colors.ui.dim}> </text>
          <text fg={statusDisplay().color}>
            [{props.toolCall.status === "success" ? "OK" : "FAIL"}]
          </text>
        </Show>
      </box>
      {/* Show truncated result if available */}
      <Show when={props.toolCall.result && props.toolCall.status !== "running"}>
        <box paddingLeft={2}>
          <text fg={Colors.ui.dim} wrapMode="none">
            {props.toolCall.result!.slice(0, 100)}{props.toolCall.result!.length > 100 ? "..." : ""}
          </text>
        </box>
      </Show>
    </box>
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
    <box flexDirection="column" marginBottom={2}>
      <box flexDirection="row" marginBottom={1}>
        <Show
          when={!isUser()}
          fallback={
            <text>
              <strong>You</strong>
            </text>
          }
        >
          {/* Assistant message: Model [MODE] */}
          <text>
            <strong>{model().toUpperCase()}</strong>
          </text>
          <Show when={mode()}>
            <text fg={Colors.ui.dim}> [</text>
            <text fg={modeColor()}>{mode()}</text>
            <text fg={Colors.ui.dim}>]</text>
          </Show>
        </Show>
      </box>
      {/* Thinking/Reasoning content - collapsible with italics and scroll */}
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
      {/* Tool calls */}
      <Show when={toolCalls().length > 0}>
        <box flexDirection="column" marginTop={1}>
          <For each={toolCalls()}>
            {(toolCall) => <ToolCallDisplay toolCall={toolCall} />}
          </For>
        </box>
      </Show>
    </box>
  );
}
