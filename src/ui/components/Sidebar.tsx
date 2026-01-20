import { createSignal, Show, For } from "solid-js";
import { Colors, Indicators, Layout } from "../design";

/**
 * Sidebar Panel Component
 * Right sidebar with session info, todos, MCP status
 * 
 * Props: None (uses props for extensibility)
 */

interface SidebarProps {
  messages?: { id: string; content: string }[];
  todos?: { id: string; content: string; status: string }[];
  contextUsage?: number;
  cost?: number;
}

export function Sidebar(props: SidebarProps = {}) {
  const [mcpExpanded, setMcpExpanded] = createSignal(false);
  const [todoExpanded, setTodoExpanded] = createSignal(false);
  const [filesExpanded, setFilesExpanded] = createSignal(false);

  const hasTodos = () => (props.todos?.length ?? 0) > 0;
  const incompleteTodos = () => props.todos?.filter(t => t.status !== "completed") ?? [];
  const shouldShowTodo = () => !!(hasTodos() && incompleteTodos().length > 0);

  const contextUsage = () => props.contextUsage ?? 0;
  const cost = () => props.cost ?? 0;

  return (
    <box
      border
      width={Layout.sidebar.width}
      flexDirection="column"
      padding={1}
    >
      {/* Session Info */}
      <box flexDirection="column" marginBottom={2}>
        <text><strong>Session</strong></text>
        <text>──────────</text>
      </box>

      {/* Context Usage */}
      <Show when={props.contextUsage !== undefined}>
        <box flexDirection="column" marginBottom={2}>
          <text fg={Colors.ui.dim}>Context:</text>
          <text>
            {contextUsage()}% ({(contextUsage() / 100 * 200).toFixed(0)}k/200k)
          </text>
          <Show when={props.cost !== undefined}>
            <text fg={Colors.ui.dim}>Cost: ${cost().toFixed(2)}</text>
          </Show>
        </box>
      </Show>

      {/* Todo Section */}
      <Show when={shouldShowTodo()}>
        <box flexDirection="column" marginBottom={2}>
          <box
            flexDirection="row"
            // @ts-ignore: OpenTUI types incomplete
            onMouseDown={() => setTodoExpanded((e) => !e)}
          >
            <text fg={Colors.ui.dim}>
              {todoExpanded() ? Indicators.expanded : Indicators.collapsed}{" "}
            </text>
            <text><strong>Todo</strong></text>
            <text fg={Colors.ui.dim}> ({incompleteTodos().length})</text>
          </box>
          <Show when={todoExpanded()}>
            <box flexDirection="column" marginLeft={1} marginTop={1}>
              <For each={incompleteTodos()}>
                {(todo: any) => (
                  <text fg={Colors.ui.dim}>
                    [ ] {todo.content}
                  </text>
                )}
              </For>
            </box>
          </Show>
        </box>
      </Show>

      {/* MCP Section */}
      <box flexDirection="column" marginBottom={2}>
        <box
          flexDirection="row"
          // @ts-ignore: OpenTUI types incomplete
          onMouseDown={() => setMcpExpanded((e) => !e)}
        >
          <text fg={Colors.ui.dim}>
            {mcpExpanded() ? Indicators.expanded : Indicators.collapsed}{" "}
          </text>
          <text><strong>MCPs</strong></text>
          <text fg={Colors.status.success}> 4/4</text>
        </box>
        <Show when={mcpExpanded()}>
          <box flexDirection="column" marginLeft={1} marginTop={1}>
            <text fg={Colors.ui.dim}>  Vision - Connected</text>
            <text fg={Colors.ui.dim}>  Web Search - Connected</text>
            <text fg={Colors.ui.dim}>  Web Reader - Connected</text>
            <text fg={Colors.ui.dim}>  Zread - Connected</text>
          </box>
        </Show>
      </box>

      {/* Modified Files Section */}
      <box flexDirection="column">
        <box
          flexDirection="row"
          // @ts-ignore: OpenTUI types incomplete
          onMouseDown={() => setFilesExpanded((e) => !e)}
        >
          <text fg={Colors.ui.dim}>
            {filesExpanded() ? Indicators.expanded : Indicators.collapsed}{" "}
          </text>
          <text><strong>Modified Files</strong></text>
        </box>
        <Show when={filesExpanded()}>
          <box flexDirection="column" marginLeft={1} marginTop={1}>
            <text fg={Colors.ui.dim}>  src/ui/App.tsx</text>
            <text fg={Colors.ui.dim}>  src/ui/components/InputArea.tsx</text>
          </box>
        </Show>
      </box>
    </box>
  );
}
