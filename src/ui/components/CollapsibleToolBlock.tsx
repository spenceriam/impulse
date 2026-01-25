import { createSignal, Show, type JSX } from "solid-js";
import { Colors, Indicators } from "../design";

/**
 * Status display configuration
 */
interface StatusConfig {
  indicator: string;
  color: string;
  autoExpand: boolean;
}

function getStatusConfig(status: string): StatusConfig {
  switch (status) {
    case "success":
      return {
        indicator: Indicators.toolStatus.success,
        color: Colors.ui.dim,
        autoExpand: false
      };
    case "error":
      return {
        indicator: Indicators.toolStatus.error,
        color: Colors.status.error,
        autoExpand: true
      };
    case "running":
      return {
        indicator: Indicators.toolStatus.running,
        color: Colors.ui.dim,
        autoExpand: false
      };
    case "pending":
    default:
      return {
        indicator: Indicators.toolStatus.pending,
        color: Colors.ui.dim,
        autoExpand: false
      };
  }
}

interface CollapsibleToolBlockProps {
  status: "pending" | "running" | "success" | "error";
  children: JSX.Element;              // Title content (always visible)
  expandedContent?: JSX.Element;      // Content shown when expanded
  defaultExpanded?: boolean;          // Override auto-expand behavior
}

export function CollapsibleToolBlock(props: CollapsibleToolBlockProps) {
  const config = () => getStatusConfig(props.status);

  // Initialize expanded state: use defaultExpanded if provided, else auto-expand for errors
  const initialExpanded = () =>
    props.defaultExpanded !== undefined
      ? props.defaultExpanded
      : config().autoExpand;

  const [expanded, setExpanded] = createSignal(initialExpanded());

  // Toggle on click (only if there's content to expand)
  const handleClick = () => {
    if (props.expandedContent) {
      setExpanded(prev => !prev);
    }
  };

  const expandIndicator = () => expanded() ? Indicators.expanded : Indicators.collapsed;
  const hasExpandableContent = () => !!props.expandedContent;

  return (
    <box flexDirection="column" paddingLeft={2}>
      {/* Clickable header line */}
      <box
        flexDirection="row"
        onMouseUp={handleClick}
      >
        {/* Expand indicator (only show if expandable) */}
        <Show when={hasExpandableContent()} fallback={<text fg={Colors.ui.dim}>{"  "}</text>}>
          <text fg={Colors.ui.dim}>{expandIndicator() + " "}</text>
        </Show>

        {/* Status indicator */}
        <text fg={config().color}>{config().indicator + " "}</text>

        {/* Title content (passed as children) */}
        {props.children}
      </box>

      {/* Expanded content */}
      <Show when={expanded() && props.expandedContent}>
        <box paddingLeft={4} flexDirection="column">
          {props.expandedContent}
        </box>
      </Show>
    </box>
  );
}
