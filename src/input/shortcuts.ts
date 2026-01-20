import { onMount, onCleanup } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useMode, useSession } from "../ui/context";

/**
 * Keyboard Shortcut Definitions
 */
const SHORTCUTS = {
  TAB: "tab",
  SHIFT_TAB: "shift+tab",
  CTRL_P: "ctrl+p",
  CTRL_M: "ctrl+m",
  ESCAPE: "escape",
  CTRL_C: "ctrl+c",
} as const;

/**
 * Keyboard Handler
 * Global keyboard shortcut handler for mode switching, commands, etc.
 */
export function useKeyboardHandler() {
  const { cycleMode, cycleModeReverse } = useMode();
  const { setThinking } = useSession();

  let ctrlCCount = 0;
  let ctrlCTimeout: ReturnType<typeof setTimeout> | null = null;
  let escCount = 0;
  let escTimeout: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    useKeyboard((key) => {
      // Mode cycling
      if (key.name === SHORTCUTS.TAB) {
        if (key.shift) {
          cycleModeReverse();
        } else {
          cycleMode();
        }
      }

      // Toggle thinking mode
      if (key.ctrl && key.name === "t") {
        setThinking((t) => !t);
      }

      // Command palette (Ctrl+P)
      if (key.ctrl && key.name === "p") {
        // TODO: Open command palette overlay
      }

      // MCP status (Ctrl+M)
      if (key.ctrl && key.name === "m") {
        // TODO: Open MCP status overlay
      }

      // Double-press escape for cancel
      if (key.name === SHORTCUTS.ESCAPE) {
        escCount++;
        if (escCount >= 2) {
          escCount = 0;
          // TODO: Cancel current operation
        }
        if (escTimeout) clearTimeout(escTimeout);
        escTimeout = setTimeout(() => {
          escCount = 0;
        }, 300);
      }

      // Double-press Ctrl+C for exit
      if (key.ctrl && key.name === "c") {
        ctrlCCount++;
        if (ctrlCCount >= 2) {
          ctrlCCount = 0;
          // Exit handled by App.tsx renderer.destroy()
        }
        if (ctrlCTimeout) clearTimeout(ctrlCTimeout);
        ctrlCTimeout = setTimeout(() => {
          ctrlCCount = 0;
        }, 500);
      }
    });
  });

  onCleanup(() => {
    if (ctrlCTimeout) clearTimeout(ctrlCTimeout);
    if (escTimeout) clearTimeout(escTimeout);
  });
}
