import { createContext, createSignal, useContext, ParentComponent, Accessor } from "solid-js";
import {
  isExpressMode,
  isExpressAcknowledged,
  enableExpress,
  disableExpress,
  acknowledgeExpress,
} from "../../permission";

/**
 * Express Context Type
 */
interface ExpressContextType {
  /** Whether Express mode is currently enabled */
  express: Accessor<boolean>;
  /** Whether the Express warning has been acknowledged this session */
  acknowledged: Accessor<boolean>;
  /** Whether we need to show the warning overlay */
  showWarning: Accessor<boolean>;
  /** Enable Express mode - returns true if warning needs to be shown */
  enable: () => boolean;
  /** Disable Express mode */
  disable: () => void;
  /** Toggle Express mode - returns { enabled, needsWarning } */
  toggle: () => { enabled: boolean; needsWarning: boolean };
  /** Acknowledge the Express warning (user pressed Enter) */
  acknowledge: () => void;
  /** Dismiss the warning overlay */
  dismissWarning: () => void;
}

/**
 * Express Context
 */
const ExpressContext = createContext<ExpressContextType>();

/**
 * Express Provider Component
 * Manages Express mode state and warning display
 */
export const ExpressProvider: ParentComponent<{ initialExpress?: boolean }> = (props) => {
  // Initialize from permission module state or prop
  const [express, setExpress] = createSignal(props.initialExpress ?? isExpressMode());
  const [acknowledged, setAcknowledged] = createSignal(isExpressAcknowledged());
  const [showWarning, setShowWarning] = createSignal(false);

  // If starting with --express flag and not yet acknowledged, show warning
  if (props.initialExpress && !isExpressAcknowledged()) {
    enableExpress();
    setShowWarning(true);
  }

  const enable = (): boolean => {
    const needsWarning = enableExpress();
    setExpress(true);
    if (needsWarning) {
      setShowWarning(true);
    }
    return needsWarning;
  };

  const disable = () => {
    disableExpress();
    setExpress(false);
  };

  const toggle = (): { enabled: boolean; needsWarning: boolean } => {
    if (express()) {
      disable();
      return { enabled: false, needsWarning: false };
    } else {
      const needsWarning = enable();
      return { enabled: true, needsWarning };
    }
  };

  const acknowledge = () => {
    acknowledgeExpress();
    setAcknowledged(true);
    setShowWarning(false);
  };

  const dismissWarning = () => {
    setShowWarning(false);
  };

  const contextValue: ExpressContextType = {
    express,
    acknowledged,
    showWarning,
    enable,
    disable,
    toggle,
    acknowledge,
    dismissWarning,
  };

  return (
    <ExpressContext.Provider value={contextValue}>
      {props.children}
    </ExpressContext.Provider>
  );
};

/**
 * Hook to use Express Context
 */
export function useExpress() {
  const context = useContext(ExpressContext);
  if (!context) {
    throw new Error("useExpress must be used within ExpressProvider");
  }
  return context;
}
