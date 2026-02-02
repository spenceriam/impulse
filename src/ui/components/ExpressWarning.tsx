import { useAppKeyboard } from "../context/keyboard";
import { Colors } from "../design";

/**
 * ExpressWarning Props
 */
interface ExpressWarningProps {
  onAcknowledge: () => void;
}

/**
 * ExpressWarning Component
 * 
 * Full-screen warning overlay shown when Express mode is enabled for the first time.
 * User must press Enter to acknowledge and continue.
 * 
 * Layout:
 * ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
 * ┃                                                             ┃
 * ┃  EXPRESS MODE ENABLED                                       ┃
 * ┃                                                             ┃
 * ┃  All tool permissions will be auto-approved.                ┃
 * ┃  The AI can:                                                ┃
 * ┃    - Edit and create files without confirmation             ┃
 * ┃    - Execute shell commands without confirmation            ┃
 * ┃    - Launch subagents without confirmation                  ┃
 * ┃                                                             ┃
 * ┃  This is useful for:                                        ┃
 * ┃    - Trusted/sandboxed environments                         ┃
 * ┃    - CI/CD pipelines                                        ┃
 * ┃    - Batch processing                                       ┃
 * ┃                                                             ┃
 * ┃  Use with caution in production environments.               ┃
 * ┃                                                             ┃
 * ┃  Toggle off anytime with /express                           ┃
 * ┃                                                             ┃
 * ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
 * 
 *                     Press Enter to continue
 */
export function ExpressWarning(props: ExpressWarningProps) {
  // Handle keyboard - Enter to acknowledge
  useAppKeyboard((key) => {
    if (key.name === "return") {
      props.onAcknowledge();
    }
  });

  return (
    <box
      position="absolute"
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
      backgroundColor="#0a0a0a"
    >
      <box flexDirection="column" alignItems="center" gap={1}>
        {/* Warning box with border */}
        <box
          border
          borderColor={Colors.status.warning}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          flexDirection="column"
          width={65}
        >
          {/* Title */}
          <box height={1} />
          <text fg={Colors.status.warning}>
            <strong>EXPRESS MODE ENABLED</strong>
          </text>
          <box height={1} />
          
          {/* Main warning */}
          <text fg={Colors.ui.text}>All tool permissions will be auto-approved.</text>
          <text fg={Colors.ui.text}>The AI can:</text>
          <text fg={Colors.ui.dim}>  - Edit and create files without confirmation</text>
          <text fg={Colors.ui.dim}>  - Execute shell commands without confirmation</text>
          <text fg={Colors.ui.dim}>  - Launch subagents without confirmation</text>
          <box height={1} />
          
          {/* Use cases */}
          <text fg={Colors.ui.text}>This is useful for:</text>
          <text fg={Colors.ui.dim}>  - Trusted/sandboxed environments</text>
          <text fg={Colors.ui.dim}>  - CI/CD pipelines</text>
          <text fg={Colors.ui.dim}>  - Batch processing</text>
          <box height={1} />
          
          {/* Caution */}
          <text fg={Colors.status.error}>Use with caution in production environments.</text>
          <box height={1} />
          
          {/* Toggle hint */}
          <text fg={Colors.ui.dim}>Toggle off anytime with /express</text>
          <box height={1} />
        </box>
        
        {/* Press Enter prompt */}
        <box height={1} />
        <text fg={Colors.ui.dim}>Press Enter to continue</text>
      </box>
    </box>
  );
}
