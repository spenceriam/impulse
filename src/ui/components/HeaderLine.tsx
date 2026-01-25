import { Colors } from "../design";

/**
 * HeaderLine Component
 * 
 * Displays at top of session screen with AI-generated context about
 * the current conversation/task. Similar to how ChatGPT/Claude/Gemini
 * auto-generate chat titles.
 * 
 * Format: [IMPULSE] | <context>
 * 
 * Prefixes for system actions:
 * - Normal: [IMPULSE] | Express mode permission system
 * - Compacted: [IMPULSE] | Compacted: Express mode permission system
 * - Reverted: [IMPULSE] | Reverted: Express mode permission system
 * - Reapplied: [IMPULSE] | Reapplied: Express mode permission system
 * 
 * Props:
 * - title: AI-generated description of current task/conversation
 * - prefix: Optional prefix for system actions (Compacted, Reverted, Reapplied)
 */

export type HeaderPrefix = "Compacted" | "Reverted" | "Reapplied" | null;

interface HeaderLineProps {
  title?: string;
  prefix?: HeaderPrefix;
}

const BRAND = "[IMPULSE]";
const DEFAULT_TITLE = "New session";

export function HeaderLine(props: HeaderLineProps) {
  const displayTitle = () => {
    const title = props.title || DEFAULT_TITLE;
    const prefixPart = props.prefix ? `${props.prefix}: ` : "";
    return `${BRAND} | ${prefixPart}${title}`;
  };

  return (
    <box flexDirection="column" flexShrink={0} width="100%">
      {/* Header with background */}
      <box 
        height={1} 
        paddingLeft={1} 
        paddingRight={1}
        backgroundColor={Colors.header.background}
      >
        <text fg={Colors.ui.text}>{displayTitle()}</text>
      </box>
      {/* Empty row for spacing */}
      <box height={1} />
    </box>
  );
}
