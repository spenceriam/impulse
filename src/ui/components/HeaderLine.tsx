import { Colors } from "../design";

/**
 * HeaderLine Component
 * 
 * Displays at top of session screen with AI-generated context about
 * the current conversation/task. Similar to how ChatGPT/Claude/Gemini
 * auto-generate chat titles.
 * 
 * Format: [GLM-CLI] | <context>
 * 
 * Prefixes for system actions:
 * - Normal: [GLM-CLI] | Express mode permission system
 * - Compacted: [GLM-CLI] | Compacted: Express mode permission system
 * - Reverted: [GLM-CLI] | Reverted: Express mode permission system
 * - Reapplied: [GLM-CLI] | Reapplied: Express mode permission system
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

const BRAND = "[GLM-CLI]";
const DEFAULT_TITLE = "New session";

export function HeaderLine(props: HeaderLineProps) {
  const displayTitle = () => {
    const title = props.title || DEFAULT_TITLE;
    const prefixPart = props.prefix ? `${props.prefix}: ` : "";
    return `${BRAND} | ${prefixPart}${title}`;
  };

  return (
    <box flexDirection="column" flexShrink={0} width="100%">
      <box height={1} paddingLeft={1} paddingRight={1}>
        <text fg={Colors.ui.text}>{displayTitle()}</text>
      </box>
      {/* Separator line - uses bottom border on a 1-height box for thin line */}
      <box border={["bottom"]} borderColor={Colors.ui.dim} height={1} />
    </box>
  );
}
