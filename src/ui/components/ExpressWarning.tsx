import { onMount, onCleanup, createSignal } from "solid-js";
import { Colors } from "../design";

/**
 * ExpressWarning Props
 */
interface ExpressWarningProps {
  onAcknowledge: () => void;
}

// Auto-dismiss delay in milliseconds
const AUTO_DISMISS_MS = 3000;

/**
 * ExpressWarning Component
 * 
 * Full-screen warning overlay shown when Express mode is enabled for the first time.
 * Auto-dismisses after 3 seconds - no user interaction required.
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
 *                     Dismissing in 3...
 */
export function ExpressWarning(props: ExpressWarningProps) {
  const [countdown, setCountdown] = createSignal(3);
  
  // Auto-dismiss after timeout
  onMount(() => {
    // Countdown interval (updates every second)
    const countdownInterval = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    
    // Auto-dismiss timer
    const dismissTimer = setTimeout(() => {
      props.onAcknowledge();
    }, AUTO_DISMISS_MS);
    
    onCleanup(() => {
      clearInterval(countdownInterval);
      clearTimeout(dismissTimer);
    });
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
        
        {/* Auto-dismiss countdown */}
        <box height={1} />
        <text fg={Colors.ui.dim}>Dismissing in {countdown()}...</text>
      </box>
    </box>
  );
}
