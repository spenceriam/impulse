import { createSignal, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { Colors, Indicators } from "../design";

/**
 * Thinking Block Component
 * Collapsible thinking display with "Thinking..." label
 * 
 * Props:
 * - content: Thinking content to display
 * - streaming: Whether content is currently being streamed
 */

interface ThinkingBlockProps {
  content?: string;
  streaming?: boolean;
}

export function ThinkingBlock(props: ThinkingBlockProps) {
  const [expanded, setExpanded] = createSignal(props.streaming ?? true);

  const showContent = () => !!props.content;

  useKeyboard((key) => {
    if (showContent() && (key.name === "enter" || key.name === "return")) {
      setExpanded((e) => !e);
    }
  });

  const handleToggle = () => {
    setExpanded((e) => !e);
  };

  return (
    <Show when={showContent()}>
      <box flexDirection="column">
        <box
          flexDirection="row"
          padding={1}
          // @ts-ignore: OpenTUI types incomplete
          onMouseDown={handleToggle}
        >
          <text fg={Colors.ui.dim}>
            {expanded() ? Indicators.expanded : Indicators.collapsed}{" "}
          </text>
          <text fg={Colors.ui.dim}>Thinking...</text>
        </box>
        <Show when={expanded()}>
          <box border marginLeft={1} padding={1}>
            <text fg={Colors.ui.dim}>{props.content}</text>
          </box>
        </Show>
      </box>
    </Show>
  );
}
