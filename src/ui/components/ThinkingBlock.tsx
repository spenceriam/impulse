import { Show } from "solid-js";
import { Colors, type Mode, getModeBackground } from "../design";

/**
 * Thinking Block Component
 * pi-mono style: always shows full thinking text unless globally hidden.
 */

/**
 * Darken a hex color by reducing its brightness.
 * Used to keep thinking content visually distinct from assistant text.
 */
function darkenColor(hex: string, factor: number = 0.7): string {
  const color = hex.replace("#", "");
  const r = parseInt(color.substring(0, 2), 16);
  const g = parseInt(color.substring(2, 4), 16);
  const b = parseInt(color.substring(4, 6), 16);

  const dr = Math.round(r * factor);
  const dg = Math.round(g * factor);
  const db = Math.round(b * factor);

  return `#${dr.toString(16).padStart(2, "0")}${dg.toString(16).padStart(2, "0")}${db.toString(16).padStart(2, "0")}`;
}

interface ThinkingBlockProps {
  content?: string;
  mode?: Mode | undefined;
}

export function ThinkingBlock(props: ThinkingBlockProps) {
  const showContent = () => !!props.content && props.content.trim().length > 0;

  return (
    <Show when={showContent()}>
      <box
        flexDirection="column"
        marginTop={1}
        marginBottom={1}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={props.mode ? darkenColor(getModeBackground(props.mode), 0.7) : Colors.message.thinking}
      >
        <text fg={Colors.ui.dim}><em>{props.content}</em></text>
      </box>
    </Show>
  );
}
