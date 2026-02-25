import { createSignal, Show, For } from "solid-js";
import { Colors, Indicators, Layout } from "../design";
import { useTodo, type Todo } from "../context";

/**
 * Custom MCP type (non-default MCPs installed by user)
 */
interface CustomMCP {
  name: string;
  status: "connected" | "disconnected" | "error";
}

/**
 * Project tree node type
 */
interface ProjectNode {
  name: string;
  type: "file" | "directory";
  children?: ProjectNode[];
}

/**
 * Sidebar Panel Component
 * Right sidebar with todos, custom MCPs, project tree
 * 
 * Props:
 * - customMcps: Array of custom (non-default) MCP servers
 * - projectTree: Project directory structure
 */

interface SidebarProps {
  customMcps?: CustomMCP[];
  projectTree?: ProjectNode[];
  onCollapse?: () => void;
}

export function Sidebar(props: SidebarProps = {}) {
  const { todos, incompleteTodos } = useTodo();
  
  const [todoExpanded, setTodoExpanded] = createSignal(true);  // Default expanded
  const [mcpExpanded, setMcpExpanded] = createSignal(true);
  const [projectExpanded, setProjectExpanded] = createSignal(false);
  const [expandedDirs, setExpandedDirs] = createSignal<Set<string>>(new Set());

  const hasCustomMcps = () => (props.customMcps?.length ?? 0) > 0;
  const hasProjectTree = () => (props.projectTree?.length ?? 0) > 0;

  // Toggle directory expansion in project tree
  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // Get todo indicator with proper coloring
  const getTodoIndicator = (status: string) => {
    switch (status) {
      case "in_progress":
        return { indicator: Indicators.todo.in_progress, color: Colors.mode.WORK };
      case "completed":
        return { indicator: Indicators.todo.completed, color: Colors.ui.dim };
      case "cancelled":
        return { indicator: Indicators.todo.cancelled, color: Colors.ui.dim };
      default:
        return { indicator: Indicators.todo.pending, color: Colors.ui.dim };
    }
  };

  // Render project tree node recursively
  const renderProjectNode = (node: ProjectNode, path: string = "", depth: number = 0) => {
    const fullPath = path ? `${path}/${node.name}` : node.name;
    const isExpanded = expandedDirs().has(fullPath);
    const indent = "  ".repeat(depth);

    if (node.type === "directory") {
      return (
        <box flexDirection="column">
          <box
            flexDirection="row"
            onMouseDown={() => toggleDir(fullPath)}
          >
            <text fg={Colors.ui.dim}>
              {indent}{isExpanded ? Indicators.expanded : Indicators.collapsed} {node.name}/
            </text>
          </box>
          <Show when={isExpanded && node.children}>
            <For each={node.children}>
              {(child) => renderProjectNode(child, fullPath, depth + 1)}
            </For>
          </Show>
        </box>
      );
    }

    return (
      <text fg={Colors.ui.dim}>
        {indent}  {node.name}
      </text>
    );
  };

  return (
    <box flexDirection="row">
      {/* Left border separator */}
      <box width={1} height="100%">
        <text fg={Colors.ui.dim}>{Indicators.separator.vertical.repeat(100)}</text>
      </box>
      {/* Sidebar content */}
      <box
        width={Layout.sidebar.width - 1}
        flexDirection="column"
        padding={1}
      >
      {/* Todo Section - Only visible when there are todos */}
      <Show when={todos().length > 0}>
        <box flexDirection="column" marginBottom={2}>
          <box
            flexDirection="row"
            onMouseDown={() => setTodoExpanded((e) => !e)}
          >
            <text fg={Colors.ui.dim}>
              {todoExpanded() ? Indicators.expanded : Indicators.collapsed}{" "}
            </text>
            <text><strong>Todo</strong></text>
            <Show when={incompleteTodos().length > 0}>
              <text fg={Colors.ui.dim}> ({incompleteTodos().length})</text>
            </Show>
          </box>
          <Show when={todoExpanded()}>
            <box flexDirection="column" marginLeft={1} marginTop={1}>
              <For each={todos()}>
                {(todo: Todo) => {
                  const { indicator, color } = getTodoIndicator(todo.status);
                  return (
                    <text fg={color}>
                      {indicator} {todo.content}
                    </text>
                  );
                }}
              </For>
            </box>
          </Show>
        </box>
      </Show>

      {/* Custom MCPs Section - Only if custom MCPs installed */}
      <Show when={hasCustomMcps()}>
        <box flexDirection="column" marginBottom={2}>
          <box
            flexDirection="row"
            onMouseDown={() => setMcpExpanded((e) => !e)}
          >
            <text fg={Colors.ui.dim}>
              {mcpExpanded() ? Indicators.expanded : Indicators.collapsed}{" "}
            </text>
            <text><strong>Custom MCPs</strong></text>
            <text fg={Colors.ui.dim}> ({props.customMcps!.length})</text>
          </box>
          <Show when={mcpExpanded()}>
            <box flexDirection="column" marginLeft={1} marginTop={1}>
              <For each={props.customMcps}>
                {(mcp) => {
                  const statusColor = mcp.status === "connected" 
                    ? Colors.status.success 
                    : mcp.status === "error" 
                      ? Colors.status.error 
                      : Colors.ui.dim;
                  return (
                    <box flexDirection="row">
                      <text fg={statusColor}>{Indicators.dot} </text>
                      <text fg={Colors.ui.text}>{mcp.name}</text>
                    </box>
                  );
                }}
              </For>
            </box>
          </Show>
        </box>
      </Show>

      {/* Project Tree Section */}
      <Show when={hasProjectTree()}>
        <box flexDirection="column">
          <box
            flexDirection="row"
            onMouseDown={() => setProjectExpanded((e) => !e)}
          >
            <text fg={Colors.ui.dim}>
              {projectExpanded() ? Indicators.expanded : Indicators.collapsed}{" "}
            </text>
            <text><strong>Project</strong></text>
          </box>
          <Show when={projectExpanded()}>
            <box flexDirection="column" marginLeft={1} marginTop={1}>
              <For each={props.projectTree}>
                {(node) => renderProjectNode(node)}
              </For>
            </box>
          </Show>
        </box>
      </Show>
      
      {/* Spacer to push collapse button to bottom */}
      <box flexGrow={1} />
      
      {/* Collapse button at bottom right */}
      <Show when={props.onCollapse}>
        <box flexDirection="row" justifyContent="flex-end">
          <box onMouseDown={() => props.onCollapse?.()}>
            <text fg={Colors.ui.dim}>[{Indicators.collapsed}]</text>
          </box>
        </box>
      </Show>
      </box>
    </box>
  );
}
