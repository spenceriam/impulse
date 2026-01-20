import { createSignal, Show, For, JSX } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { Colors, Indicators } from "../design";

/**
 * Tool result type
 */
export interface ToolResult {
  name: string;
  path?: string;
  success: boolean;
  output?: string;
  language?: string;
  diff?: { additions: string[]; deletions: string[] };
}

/**
 * Format diff line with colors
 */
function formatDiffLine(line: string): JSX.Element {
  if (line.startsWith("+")) {
    return (
      <text fg={Colors.diff.addition}>
        {line}
      </text>
    );
  }
  if (line.startsWith("-")) {
    return (
      <text fg={Colors.diff.deletion}>
        {line}
      </text>
    );
  }
  return <text>{line}</text>;
}

/**
 * Tool Block Component
 * Collapsible tool result display with diff support
 * 
 * Props:
 * - tool: Tool result to display
 */

interface ToolBlockProps {
  tool: ToolResult;
}

export function ToolBlock(props: ToolBlockProps) {
  const [expanded, setExpanded] = createSignal(false);

  const statusText = () => props.tool.success
    ? Indicators.tool.success
    : Indicators.tool.error;
  const statusColor = () => props.tool.success
    ? Colors.status.success
    : Colors.status.error;

  useKeyboard((key) => {
    if (key.name === "enter" || key.name === "return") {
      setExpanded((e) => !e);
    }
  });

  const handleToggle = () => {
    setExpanded((e) => !e);
  };

  return (
    <box flexDirection="column">
      <box
        flexDirection="row"
        padding={0.5}
        // @ts-ignore: OpenTUI types incomplete
        onMouseDown={handleToggle}
      >
        <text fg={Colors.ui.dim}>
          {expanded() ? Indicators.expanded : Indicators.collapsed}{" "}
        </text>
        <text>{props.tool.name} </text>
        <Show when={props.tool.path}>
          <text fg={Colors.ui.dim}>{props.tool.path}</text>
        </Show>
        <box flexGrow={1} />
        <text fg={statusColor()}>{statusText()}</text>
      </box>

      <Show when={expanded() && props.tool.output}>
        <box border marginLeft={2} marginTop={1} padding={1}>
          <Show when={props.tool.diff}>
            <box flexDirection="column">
              <For each={props.tool.diff!.additions}>
                {(line) => formatDiffLine(`+${line}`)}
              </For>
              <For each={props.tool.diff!.deletions}>
                {(line) => formatDiffLine(`-${line}`)}
              </For>
            </box>
          </Show>
          <Show when={!props.tool.diff}>
            <Show when={props.tool.language}>
              {/* @ts-ignore: OpenTUI types incomplete */}
              <line_number
                code={props.tool.output ?? ""}
                language={props.tool.language}
              />
            </Show>
            <Show when={!props.tool.language}>
              <text>{props.tool.output}</text>
            </Show>
          </Show>
        </box>
      </Show>
    </box>
  );
}
