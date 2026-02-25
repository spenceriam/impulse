import { For, Show, type JSX, type Accessor } from "solid-js";
import { Colors, Indicators, type Mode, getModeColor, getModeBackground } from "../design";
import type { ToolMetadata, TodoMetadata } from "../../types/tool-metadata";
import {
  isBashMetadata,
  isFileEditMetadata,
  isFileWriteMetadata,
  isFileReadMetadata,
  isGlobMetadata,
  isGrepMetadata,
  isTaskMetadata,
  isTodoMetadata,
  isQuestionMetadata,
} from "../../types/tool-metadata";
import { CollapsibleToolBlock } from "./CollapsibleToolBlock";
import { DiffView } from "./DiffView";
import { TerminalOutput } from "./TerminalOutput";
import { ThinkingBlock } from "./ThinkingBlock";
import { BouncingDots } from "./BouncingDots";
import { useSession } from "../context/session";
import { useMode } from "../context/mode";
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
  status: "pending" | "running" | "success" | "error" | "cancelled";
  result?: string;
  metadata?: ToolMetadata;  // Structured metadata for enhanced display
}

/**
 * Reasoning segment for multi-phase thinking
 */
export interface ReasoningSegment {
  content: string;
  streaming: boolean;
}

/**
 * Ordered assistant content block (pi-mono style).
 * Preserves streamed order across text, thinking, and tool calls.
 */
export type AssistantContentBlock =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "thinking"; thinking: string }
  | { id: string; type: "tool_call"; toolCallId: string };

export interface ValidationSummary {
  findings: string[];
  nextSteps: string[];
}

/**
 * Message type
 */
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;    // Thinking/reasoning content (GLM-specific)
  reasoningSegments?: ReasoningSegment[]; // Per-phase thinking blocks
  mode?: Mode;           // Mode used when generating (for assistant messages)
  model?: string;        // Model used (e.g., "glm-4.7")
  toolCalls?: ToolCallInfo[];  // Tool calls made in this message
  contentBlocks?: AssistantContentBlock[]; // Ordered assistant render blocks
  validation?: ValidationSummary; // Non-model self-check summary
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

function renderMarkdownContent(content: string) {
  const nodes = parseMarkdown(content);
  return (
    <box flexDirection="column">
      <For each={nodes}>
        {(node: MarkdownNode) => renderMarkdownNode(node)}
      </For>
    </box>
  );
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
  const truncate = (value: string, max: number = 60) =>
    value.length > max ? value.slice(0, max - 3) + "..." : value;

  const formatKeyValue = (key: string, value: string) =>
    `${key}="${truncate(value)}"`;

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

    if (isTodoMetadata(metadata)) {
      const total = metadata.total ?? metadata.todos.length;
      const remaining = metadata.remaining ?? metadata.todos.filter(
        (t) => t.status !== "completed" && t.status !== "cancelled"
      ).length;
      return `${name} (${remaining}/${total})`;
    }

    if (isQuestionMetadata(metadata)) {
      const count = metadata.questions.length;
      return `question (${count} topic${count === 1 ? "" : "s"})`;
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
    const pathKeys = ["filePath", "path", "file", "filepath", "filename"];
    for (const key of pathKeys) {
      if (parsed[key]) {
        const val = String(parsed[key]);
        return `${name} ${truncate(val)}`;
      }
    }

    // Pattern-based tools
    if (parsed.pattern) {
      return `${name} "${truncate(String(parsed.pattern))}"`;
    }

    // Query/search-like tools
    const labeledKeys: Array<{ key: string; label: string }> = [
      { key: "query", label: "q" },
      { key: "q", label: "q" },
      { key: "url", label: "url" },
      { key: "command", label: "cmd" },
      { key: "expression", label: "expr" },
      { key: "location", label: "location" },
      { key: "ticker", label: "ticker" },
      { key: "team", label: "team" },
      { key: "opponent", label: "opponent" },
      { key: "model", label: "model" },
    ];

    for (const { key, label } of labeledKeys) {
      if (parsed[key]) {
        return `${name} ${formatKeyValue(label, String(parsed[key]))}`;
      }
    }

    // Task tool
    if (name === "task" && parsed.subagent_type) {
      return `task [${parsed.subagent_type}] "${parsed.description || ""}"`;
    }

    // Generic: first string-like field
    const firstStringEntry = Object.entries(parsed).find(([, value]) => typeof value === "string" && value.length > 0);
    if (firstStringEntry) {
      const [key, value] = firstStringEntry;
      return `${name} ${formatKeyValue(key, String(value))}`;
    }
  } catch {
    // Attempt a loose parse for partially-streamed JSON
    const extractArg = (key: string): string | null => {
      const match = args.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
      return match?.[1] ?? null;
    };

    const looseKeys = ["filePath", "path", "file", "pattern", "query", "q", "url", "command", "expression", "location"];
    for (const key of looseKeys) {
      const val = extractArg(key);
      if (val) {
        if (["filePath", "path", "file"].includes(key)) {
          return `${name} ${truncate(val)}`;
        }
        const label = key === "query" ? "q" : key;
        return `${name} ${formatKeyValue(label, val)}`;
      }
    }
  }

  return name;
}

function getTodoDisplay(status: TodoMetadata["todos"][number]["status"]) {
  switch (status) {
    case "in_progress":
      return {
        indicator: Indicators.todo.in_progress,
        color: Colors.mode.WORK,
        strikethrough: false,
      };
    case "completed":
      return {
        indicator: Indicators.todo.completed,
        color: Colors.ui.dim,
        strikethrough: false,
      };
    case "cancelled":
      return {
        indicator: Indicators.todo.cancelled,
        color: Colors.ui.dim,
        strikethrough: true,
      };
    default:
      return {
        indicator: Indicators.todo.pending,
        color: Colors.ui.dim,
        strikethrough: false,
      };
  }
}

function renderTodoSnapshot(metadata: TodoMetadata): JSX.Element {
  const total = metadata.total ?? metadata.todos.length;
  const remaining = metadata.remaining ?? metadata.todos.filter(
    (t) => t.status !== "completed" && t.status !== "cancelled"
  ).length;
  const currentTodo = metadata.todos.find((t) => t.status === "in_progress")
    ?? metadata.todos.find((t) => t.status === "pending");

  return (
    <box flexDirection="column">
      <text fg={Colors.ui.dim}>Todo ({remaining}/{total})</text>
      <Show
        when={currentTodo}
        fallback={<text fg={Colors.ui.dim}>Current: (none)</text>}
      >
        {(todo: Accessor<TodoMetadata["todos"][number]>) => {
          const display = getTodoDisplay(todo().status);
          return (
            <box flexDirection="row">
              <text fg={Colors.ui.dim}>Current: </text>
              <text fg={display.color}>{display.indicator} {todo().content}</text>
            </box>
          );
        }}
      </Show>
      <Show
        when={metadata.todos.length > 0}
        fallback={<text fg={Colors.ui.dim}>No tasks</text>}
      >
        <For each={metadata.todos}>
          {(todo) => {
            const display = getTodoDisplay(todo.status);
            const content = `${display.indicator} ${todo.content}`;
            return (
              <box flexDirection="row">
                <Show
                  when={display.strikethrough}
                  fallback={<text fg={display.color}>{content}</text>}
                >
                  <text fg={display.color}>
                    <s>{content}</s>
                  </text>
                </Show>
              </box>
            );
          }}
        </For>
      </Show>
    </box>
  );
}

/**
 * Generate expanded content for a tool call based on its metadata
 * Returns null if no expanded content available
 */
function getExpandedContent(
  name: string,
  metadata?: ToolMetadata,
  _result?: string,
  status?: "pending" | "running" | "success" | "error" | "cancelled"
): JSX.Element | null {
  if ((status === "pending" || status === "running") && !metadata) {
    const pendingLabel = name === "task"
      ? "Sub-agent processing "
      : name === "question"
        ? "Question processing "
        : "Processing ";
    return (
      <box flexDirection="row">
        <text fg={Colors.ui.dim}>{pendingLabel}</text>
        <BouncingDots color={Colors.ui.dim} />
      </box>
    );
  }

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

  // Todo: show snapshot list
  if (isTodoMetadata(metadata)) {
    return renderTodoSnapshot(metadata);
  }

  if (isQuestionMetadata(metadata)) {
    return (
      <box flexDirection="column">
        <Show
          when={metadata.context && metadata.context.trim().length > 0}
        >
          <text fg={Colors.ui.dim}>Context: {metadata.context}</text>
        </Show>
        <For each={metadata.questions}>
          {(question, index) => {
            const answers = question.answers.length > 0 ? question.answers.join(", ") : "(no selection)";
            return (
              <box flexDirection="column" marginTop={index() === 0 && !metadata.context ? 0 : 1}>
                <text fg={Colors.ui.dim}>
                  {question.topic}: {question.question}
                </text>
                <text fg={Colors.ui.text}>→ {answers}</text>
              </box>
            );
          }}
        </For>
      </box>
    );
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
    props.toolCall.result,
    props.toolCall.status
  );

  // Keep high-signal outputs visible by default (diffs/todos), while
  // preserving compact display for most tool calls.
  const defaultExpanded = () => {
    if (props.verbose === true) return true;
    if ((props.toolCall.status === "pending" || props.toolCall.status === "running") && props.toolCall.name === "task") {
      return true;
    }
    if ((props.toolCall.status === "pending" || props.toolCall.status === "running") && props.toolCall.name === "question") {
      return true;
    }
    if (props.toolCall.status === "success" && ["file_write", "file_edit", "todo_write", "todo_read"].includes(props.toolCall.name)) {
      return true;
    }
    return false;
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
        <text fg={Colors.ui.dim}> (attempt {props.attemptNumber})</text>
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
  const { verboseTools, hideThinkingBlocks } = useSession();
  const { mode: appMode } = useMode();

  const isUser = () => props.message.role === "user";
  const model = () => props.message.model || "GLM-4.7";
  const mode = () => props.message.mode;
  // AI messages use mode color; default to WORK color if no mode set
  const modeColor = () => mode() ? getModeColor(mode()!) : Colors.mode.WORK;
  const toolCalls = () => props.message.toolCalls ?? [];
  const validationSummary = (): ValidationSummary => {
    const raw = props.message.validation as Partial<ValidationSummary> | undefined;
    const findings = Array.isArray(raw?.findings)
      ? raw.findings.filter((item): item is string => typeof item === "string")
      : [];
    const nextSteps = Array.isArray(raw?.nextSteps)
      ? raw.nextSteps.filter((item): item is string => typeof item === "string")
      : [];
    return { findings, nextSteps };
  };
  const showValidationSummary = () =>
    (appMode() === "DEBUG" || verboseTools()) &&
    (validationSummary().findings.length > 0 || validationSummary().nextSteps.length > 0);
  const isStreaming = () => props.message.streaming ?? false;
  const reasoningSegments = () => {
    if (props.message.reasoningSegments && props.message.reasoningSegments.length > 0) {
      return props.message.reasoningSegments;
    }
    if (props.message.reasoning) {
      return [{ content: props.message.reasoning, streaming: isStreaming() }];
    }
    return [];
  };
  const thinkingSegments = () =>
    reasoningSegments().filter((segment) => segment.content && segment.content.trim().length > 0);
  const orderedBlocks = () => {
    if (props.message.contentBlocks && props.message.contentBlocks.length > 0) {
      return props.message.contentBlocks;
    }

    // Legacy fallback for old sessions/messages that only have separate fields.
    const blocks: AssistantContentBlock[] = [];
    const segments = thinkingSegments();

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!seg || !seg.content || !seg.content.trim()) continue;
      blocks.push({
        id: `legacy-thinking-${i}`,
        type: "thinking",
        thinking: seg.content,
      });
    }

    if (props.message.content && props.message.content.trim()) {
      blocks.push({
        id: "legacy-text",
        type: "text",
        text: props.message.content,
      });
    }

    for (const tc of toolCalls()) {
      blocks.push({
        id: `legacy-tool-${tc.id}`,
        type: "tool_call",
        toolCallId: tc.id,
      });
    }

    return blocks;
  };

  const hasAssistantBlocks = () => orderedBlocks().length > 0;
  const hasActiveToolCall = () =>
    toolCalls().some((toolCall) => toolCall.status === "pending" || toolCall.status === "running");
  const hasHiddenThinkingPlaceholder = () =>
    hideThinkingBlocks() && orderedBlocks().some((block) => block.type === "thinking");
  const showInitialThinking = () => isStreaming() && !hasAssistantBlocks();
  const showStreamingIndicator = () =>
    isStreaming() &&
    hasAssistantBlocks() &&
    !hasActiveToolCall() &&
    !hasHiddenThinkingPlaceholder();

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

  const renderAssistantBlock = (block: AssistantContentBlock) => {
    if (block.type === "text") {
      return (
        <box flexDirection="column" marginTop={1}>
          {renderMarkdownContent(block.text)}
        </box>
      );
    }

    if (block.type === "thinking") {
      if (hideThinkingBlocks()) {
        return (
          <box flexDirection="row" marginTop={1}>
            <text fg={Colors.ui.dim}><em>Processing...</em></text>
          </box>
        );
      }

      return (
        <ThinkingBlock
          content={block.thinking}
          mode={mode()}
        />
      );
    }

    const list = toolCalls();
    const toolIndex = list.findIndex((toolCall) => toolCall.id === block.toolCallId);
    if (toolIndex === -1) return null;

    const toolCall = list[toolIndex];
    if (!toolCall) return null;

    const attempt = getAttemptNumber(toolIndex);
    const displayProps: { toolCall: ToolCallInfo; attemptNumber?: number; verbose?: boolean } = {
      toolCall,
      verbose: verboseTools(),
    };
    if (attempt !== undefined) {
      displayProps.attemptNumber = attempt;
    }

    return (
      <box flexDirection="column" marginTop={1}>
        <ToolCallDisplay {...displayProps} />
      </box>
    );
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
            
            {/* Bouncing dots during initial processing (before first block arrives) */}
            <Show when={showInitialThinking()}>
              <box flexDirection="row" marginTop={1}>
                <text fg={Colors.ui.dim}>Processing </text>
                <BouncingDots color={modeColor()} />
              </box>
            </Show>

            {/* Ordered assistant stream blocks (text/thinking/tool_call) */}
            <Show when={hasAssistantBlocks()}>
              <box flexDirection="column">
                <For each={orderedBlocks()}>
                  {(block) => renderAssistantBlock(block)}
                </For>
              </box>
            </Show>

            {/* Keep a live indicator visible while the turn is still streaming. */}
            <Show when={showStreamingIndicator()}>
              <box flexDirection="row" marginTop={1}>
                <text fg={Colors.ui.dim}>Processing </text>
                <BouncingDots color={modeColor()} />
              </box>
            </Show>

            <Show when={showValidationSummary()}>
              {(() => (
                <box
                  flexDirection="column"
                  marginTop={1}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor="#1a1a1a"
                >
                  <text fg={Colors.ui.dim}><strong>Self-check</strong></text>
                  <Show when={validationSummary().findings.length > 0}>
                    <box flexDirection="column" marginTop={1}>
                      <text fg={Colors.ui.dim}>Findings</text>
                      <For each={validationSummary().findings}>
                        {(item) => (
                          <text fg={Colors.ui.dim}>- {item}</text>
                        )}
                      </For>
                    </box>
                  </Show>
                  <Show when={validationSummary().nextSteps.length > 0}>
                    <box flexDirection="column" marginTop={1}>
                      <text fg={Colors.ui.dim}>Next steps</text>
                      <For each={validationSummary().nextSteps}>
                        {(item) => (
                          <text fg={Colors.ui.dim}>- {item}</text>
                        )}
                      </For>
                    </box>
                  </Show>
                </box>
              ))()}
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
          {/* Empty row above user content */}
          <box height={1} />
          <Show when={props.message.content}>
            {renderMarkdownContent(props.message.content)}
          </Show>
          {/* Empty row below user content */}
          <box height={1} />
        </box>
        
        {/* Bottom accent line - gray, thin horizontal line */}
        <box height={1} width="100%" overflow="hidden">
          <text fg={userAccentColor}>{THIN_LINE.repeat(500)}</text>
        </box>
      </box>
    </Show>
  );
}
