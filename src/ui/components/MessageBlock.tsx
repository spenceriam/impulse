import { For } from "solid-js";
import { Colors } from "../design";

/**
 * Message type
 */
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
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

export function MessageBlock(props: MessageBlockProps) {
  const parsed = () => parseMarkdown(props.message.content);

  const isUser = () => props.message.role === "user";

  return (
    <box flexDirection="column" marginBottom={2}>
      <box flexDirection="row" marginBottom={1}>
        <text>
          <strong>
            {isUser() ? "You" : "GLM-4.7"}
          </strong>
        </text>
        <text fg={Colors.ui.dim}> ─── </text>
      </box>
      <box flexDirection="column">
        <For each={parsed()}>
          {(node: MarkdownNode) => renderMarkdownNode(node)}
        </For>
      </box>
    </box>
  );
}
