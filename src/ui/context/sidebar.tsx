import { createContext, createSignal, useContext, ParentComponent, Accessor } from "solid-js";

/**
 * Sidebar Context Type
 */
interface SidebarContextType {
  visible: Accessor<boolean>;
  toggle: () => void;
  show: () => void;
  hide: () => void;
}

/**
 * Sidebar Context
 */
const SidebarContext = createContext<SidebarContextType>();

/**
 * Sidebar Provider Component
 * Manages sidebar visibility state
 */
export const SidebarProvider: ParentComponent = (props) => {
  const [visible, setVisible] = createSignal<boolean>(false); // Default: collapsed, toggle with Ctrl+B

  const toggle = () => setVisible((v) => !v);
  const show = () => setVisible(true);
  const hide = () => setVisible(false);

  const contextValue: SidebarContextType = {
    visible,
    toggle,
    show,
    hide,
  };

  return (
    <SidebarContext.Provider value={contextValue}>
      {props.children}
    </SidebarContext.Provider>
  );
};

/**
 * Hook to use Sidebar Context
 */
export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within SidebarProvider");
  }
  return context;
}
