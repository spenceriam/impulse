import { createSignal, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { PasteEvent, TextareaRenderable } from "@opentui/core";
import { Colors, Mode, Layout } from "../design";

/**
 * Input Area Component
 * Boxed input with mode in title, ghost text, and multi-line support
 * 
 * Features:
 * - Multi-line text input via textarea
 * - Paste support (Ctrl+V / Cmd+V)
 * - Undo support (Ctrl+Z / Cmd+Z) - handled by textarea internally
 * - Enter to submit, Shift+Enter for newline
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
  let textareaRef: TextareaRenderable | undefined;

  const ghostText = "What are we building, breaking, or making better?";

  useKeyboard((key) => {
    // Submit on Enter (but not Shift+Enter which adds newline)
    if (key.name === "enter" && !key.shift) {
      if (value().trim()) {
        props.onSubmit?.(value());
        setValue("");
        // Clear the textarea
        if (textareaRef) {
          textareaRef.clear();
        }
      }
    }
  });

  // Handle paste events
  const handlePaste = (event: PasteEvent) => {
    // Normalize line endings
    const pastedText = event.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    
    if (pastedText) {
      // Let the textarea handle inserting the text naturally
      // The onContentChange will update our signal
      // We don't preventDefault here so the textarea inserts the text
    }
  };

  // Handle content changes from textarea
  const handleContentChange = () => {
    if (textareaRef) {
      setValue(textareaRef.plainText);
    }
  };

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
            ref={(r: TextareaRenderable) => { textareaRef = r; }}
            onContentChange={handleContentChange}
            onPaste={handlePaste}
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
