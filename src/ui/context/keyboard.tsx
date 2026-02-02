import { createContext, useContext, type ParentComponent, onCleanup, onMount } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { KeyEvent } from "@opentui/core";

type KeyHandler = (key: KeyEvent) => void;

interface KeyboardEntry {
  handler: KeyHandler;
  active?: () => boolean;
}

interface KeyboardContextValue {
  register: (handler: KeyHandler, active?: () => boolean) => () => void;
}

const KeyboardContext = createContext<KeyboardContextValue>();

export const KeyboardProvider: ParentComponent = (props) => {
  const handlers = new Set<KeyboardEntry>();

  useKeyboard((key) => {
    for (const entry of handlers) {
      if (entry.active && !entry.active()) continue;
      entry.handler(key);
      if (key.propagationStopped) break;
    }
  });

  const register = (handler: KeyHandler, active?: () => boolean) => {
    const entry: KeyboardEntry = active ? { handler, active } : { handler };
    handlers.add(entry);
    return () => {
      handlers.delete(entry);
    };
  };

  return (
    <KeyboardContext.Provider value={{ register }}>
      {props.children}
    </KeyboardContext.Provider>
  );
};

export function useAppKeyboard(handler: KeyHandler, options?: { active?: () => boolean }): void {
  const ctx = useContext(KeyboardContext);
  onMount(() => {
    if (!ctx) return;
    const unregister = ctx.register(handler, options?.active);
    onCleanup(unregister);
  });
}
