import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { Bus, ModeEvents } from "../bus";
import { getCurrentMode, setCurrentMode } from "./mode-state.js";
import { transitionModeAuthority } from "./mode-transition.js";

/**
 * Valid modes the AI can switch to
 */
const VALID_MODES = ["ASK", "AGENT"] as const;

/**
 * Tool description for AI
 */
const DESCRIPTION = `Request a switch between ASK and AGENT.

Required: mode. Optional: reason.
The model may switch AGENT to ASK. Switching ASK to AGENT requires explicit user authority; use execution_handoff for consequential work.
See docs/tools/set-mode.md for guidelines.`;

const SetModeSchema = z.object({
  mode: z
    .enum(VALID_MODES)
    .describe("The mode to switch to"),
  reason: z
    .string()
    .max(100)
    .optional()
    .describe("Brief explanation of why switching (shown to user)"),
});

type SetModeInput = z.infer<typeof SetModeSchema>;

export const setMode: Tool<SetModeInput> = Tool.define(
  "set_mode",
  DESCRIPTION,
  SetModeSchema,
  async (input: SetModeInput): Promise<ToolResult> => {
    try {
      const { mode, reason } = input;
      const currentMode = getCurrentMode();

      if (currentMode === "ASK" && mode === "AGENT") {
        return {
          success: false,
          output: "User confirmation is required to switch to AGENT. Use execution_handoff so the user can choose Preview safely, Switch to AGENT, or Stay in ASK; do not silently elevate authority.",
          metadata: {
            mode: currentMode,
            requestedMode: mode,
            requiresUserConfirmation: true,
          },
        };
      }

      let stoppedJobs = 0;
      let stoppedShells = 0;
      if (currentMode !== mode) {
        const transition = await transitionModeAuthority(currentMode, mode, {
          source: "model",
          ...(reason ? { reason } : {}),
        });
        if (transition.pending) {
          return {
            success: true,
            output: "De-escalation to ASK is pending. Mode remains AGENT until this turn stops and all execution participants are confirmed stopped.",
            metadata: {
              mode: currentMode,
              requestedMode: mode,
              pending: true,
              ...(transition.duplicate ? { duplicate: true } : {}),
            },
          };
        }
        if (!transition.changed) {
          return {
            success: false,
            output: `Mode remains ${currentMode}. Failed to stop execution participants: ${transition.failedJobIds.join(", ")}.`,
            metadata: {
              mode: currentMode,
              requestedMode: mode,
              stoppedJobs: transition.stoppedJobs,
              stoppedShells: transition.stoppedShells ?? 0,
              failedJobIds: transition.failedJobIds,
            },
          };
        }
        stoppedJobs = transition.stoppedJobs;
        stoppedShells = transition.stoppedShells ?? 0;
      }

      setCurrentMode(mode);
      // Emit event for UI to pick up
      Bus.publish(ModeEvents.Changed, { mode, reason });

      const reasonText = reason ? ` (${reason})` : "";
      const stoppedText = stoppedJobs > 0
        ? `; stopped ${stoppedJobs} background ${stoppedJobs === 1 ? "job" : "jobs"}`
        : "";
      const stoppedShellText = stoppedShells > 0 ? "; stopped active shell" : "";
      return {
        success: true,
        output: `Mode switched to ${mode}${reasonText}${stoppedText}${stoppedShellText}`,
        metadata: {
          mode,
          reason,
          stoppedJobs,
          stoppedShells,
        },
      };
    } catch (error) {
      if (error instanceof Error) {
        return {
          success: false,
          output: error.message,
        };
      }

      return {
        success: false,
        output: String(error),
      };
    }
  }
);
