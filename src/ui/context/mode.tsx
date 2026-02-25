import { createContext, createSignal, useContext, ParentComponent, Accessor, Setter, onMount, onCleanup } from "solid-js";
import { Mode } from "../design";
import { Bus, ModeEvents } from "../../bus";

/**
 * Mode Context Type
 */
interface ModeContextType {
  mode: Accessor<Mode>;
  setMode: Setter<Mode>;
  thinking: Accessor<boolean>;
  setThinking: Setter<boolean>;
  cycleMode: () => void;
  cycleModeReverse: () => void;
}

/**
 * Mode Provider Props
 */
interface ModeProviderProps {
  initialMode?: Mode;
  children?: any;
}

/**
 * Mode Context
 */
const ModeContext = createContext<ModeContextType>();

/**
 * Mode Provider Component
 * Manages current execution mode and thinking toggle
 */
export const ModeProvider: ParentComponent<ModeProviderProps> = (props) => {
  const [mode, setModeRaw] = createSignal<Mode>(props.initialMode ?? "WORK");
  const [thinking, setThinking] = createSignal<boolean>(true);

  const modes: Mode[] = ["WORK", "EXPLORE", "PLAN", "DEBUG"];

  const setMode = (value: Mode | ((prev: Mode) => Mode)) => {
    setModeRaw(value);
  };

  const cycleMode = () => {
    setMode((current) => {
      const currentIndex = modes.indexOf(current as Mode);
      const nextIndex = (currentIndex + 1) % modes.length;
      return modes[nextIndex] as Mode;
    });
  };

  const cycleModeReverse = () => {
    setMode((current) => {
      const currentIndex = modes.indexOf(current as Mode);
      const prevIndex = (currentIndex - 1 + modes.length) % modes.length;
      return modes[prevIndex] as Mode;
    });
  };

  // Subscribe to mode changes from the AI (via set_mode tool)
  onMount(() => {
    const unsubscribe = Bus.subscribe((event) => {
      if (event.type === ModeEvents.Changed.name) {
        const payload = event.properties as { mode: Mode; reason?: string };
        setModeRaw(payload.mode);
      }
    });

    onCleanup(() => {
      unsubscribe();
    });
  });

  const contextValue = {
    mode,
    setMode,
    thinking,
    setThinking,
    cycleMode,
    cycleModeReverse,
  };

  return (
    <ModeContext.Provider value={contextValue}>
      {props.children}
    </ModeContext.Provider>
  );
};

/**
 * Hook to use Mode Context
 */
export function useMode() {
  const context = useContext(ModeContext);
  if (!context) {
    throw new Error("useMode must be used within ModeProvider");
  }
  return context;
}
