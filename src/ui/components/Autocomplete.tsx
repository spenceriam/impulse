import { createSignal, Show, For, createEffect } from "solid-js";
import { useAppKeyboard } from "../context/keyboard";
import { Colors } from "../design";

/**
 * Autocomplete Props
 */
export interface AutocompleteProps {
  show: boolean;
  position: { row: number; col: number };
  candidates: AtCandidate[];
  onSelect: (candidate: AtCandidate) => void;
  onDismiss: () => void;
}

export interface AtCandidate {
  path: string;
  display: string;
  type: "file" | "directory";
}

/**
 * Autocomplete Component
 * Dropdown for @ reference completion with keyboard navigation
 */
export function Autocomplete(props: AutocompleteProps) {
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  useAppKeyboard((key) => {
    if (!props.show) return;

    switch (key.name) {
      case "arrowup":
      case "k":
        setSelectedIndex((i) => Math.max(0, i - 1));
        break;
      case "arrowdown":
      case "j":
        setSelectedIndex((i) => Math.min(props.candidates.length - 1, i + 1));
        break;
              case "enter":
      case "return":
        const selectedCandidate = props.candidates[selectedIndex()];
        if (selectedCandidate) {
          props.onSelect(selectedCandidate);
        }
        break;
      case "escape":
        props.onDismiss();
        break;
    }
  });

  // Auto-select first candidate on show
  createEffect(() => {
    if (props.show && props.candidates.length > 0) {
      setSelectedIndex(0);
    }
  }, props.show);

  if (!props.show || props.candidates.length === 0) {
    return null;
  }

  return (
    <Show when={props.show && props.candidates.length > 0}>
      <box
        border
        flexDirection="column"
        width={50}
        maxHeight={10}
        // @ts-ignore: OpenTUI types incomplete for positioning
        style={{
          position: "absolute",
          top: props.position.row + 1,
          left: props.position.col,
        }}
      >
        <For each={props.candidates}>
          {(candidate, i) => (
            <box
              flexDirection="row"
              padding={1}
              onMouseDown={() => props.onSelect(candidate)}
              // @ts-ignore: OpenTUI types incomplete
              style={i() === selectedIndex() ? { backgroundColor: "#333333" } : {}}
            >
              <text fg={candidate.type === "directory" ? Colors.ui.dim : Colors.ui.text}>
                {i() === selectedIndex() ? ">" : " "}
              </text>
              <text>{candidate.display}</text>
              <Show when={candidate.type === "directory"}>
                <text fg={Colors.ui.dim}>/</text>
              </Show>
            </box>
          )}
        </For>
      </box>
    </Show>
  );
}
