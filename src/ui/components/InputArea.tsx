import { createSignal, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { Colors, Mode, Layout } from "../design";

/**
 * Input Area Component
 * Boxed input with mode in title, ghost text, and multi-line support
 * 
 * Props:
 * - mode: Current mode (AUTO, AGENT, PLANNER, PLAN-PRD, DEBUG)
 * - thinking: Whether thinking mode is enabled
 * - onSubmit: Callback when user presses Enter to submit
 */

interface InputAreaProps {
  mode: Mode;
  thinking: boolean;
  onSubmit?: (value: string) => void;
}

export function InputArea(props: InputAreaProps) {
  const [value, setValue] = createSignal("");

  const ghostText = "What are we building, breaking, or making better?";

  useKeyboard((key) => {
    if (key.name === "enter" && !key.shift) {
      if (value().trim()) {
        props.onSubmit?.(value());
        setValue("");
      }
    }
  });

  const title = () => {
    const thinkingSuffix = props.thinking ? " (Thinking)" : "";
    return `${props.mode}${thinkingSuffix}`;
  };

  return (
    <box
      border
      title={title()}
      titleAlignment="left"
      flexDirection="column"
      padding={1}
    >
      <box flexDirection="column">
        <box flexDirection="row">
          <text fg={Colors.ui.dim}>{">"} </text>
          <textarea
            // @ts-expect-error: OpenTUI types incomplete for SolidJS
            value={value()}
            onInput={setValue}
            placeholder=""
            width={-1}
            height={Layout.input.maxHeight - 2}
            focused
          />
        </box>
        <Show when={!value()}>
          <text fg={Colors.ui.dim}>
            {"  "}{ghostText}
          </text>
        </Show>
      </box>
    </box>
  );
}
