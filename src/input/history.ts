import { createSignal } from "solid-js";

/**
 * Input History Manager
 * Manages submitted inputs for navigation with up/down arrows
 */

export interface InputHistory {
  items: string[];
  currentIndex: number;
  currentInput: string;
}

export function useInputHistory() {
  const [items, setItems] = createSignal<string[]>([]);
  const [currentIndex, setCurrentIndex] = createSignal<number>(-1);
  const [currentInput, setCurrentInput] = createSignal<string>("");

  /**
   * Add a new item to history
   */
  const addItem = (input: string): void => {
    if (!input.trim()) {
      return;
    }

    // Don't add if same as last item
    if (items()[0] === input) {
      return;
    }

    setItems((prev) => [input, ...prev]);
    setCurrentIndex(-1);
  };

  /**
   * Navigate to previous input (up arrow)
   */
  const goBack = (): string => {
    const historyItems = items();
    
    if (historyItems.length === 0) {
      return currentInput();
    }

    // If we're not in history, start from beginning
    if (currentIndex() === -1) {
      setCurrentIndex(0);
      const item = historyItems[0];
      if (item) {
        setCurrentInput(item);
      }
      return item || "";
    }

    // Move to previous item
    const newIndex = Math.min(currentIndex() + 1, historyItems.length - 1);
    setCurrentIndex(newIndex);
    const item = historyItems[newIndex];
    if (item) {
      setCurrentInput(item);
    }
    return item || "";
  };

  /**
   * Navigate to next input (down arrow)
   */
  const goForward = (): string => {
    const historyItems = items();

    if (currentIndex() === -1) {
      return currentInput();
    }

    // Move to next item
    const newIndex = currentIndex() - 1;
    
    if (newIndex < 0) {
      // Back to current input
      setCurrentIndex(-1);
      return currentInput();
    }

    setCurrentIndex(newIndex);
    const item = historyItems[newIndex];
    if (item) {
      setCurrentInput(item);
    }
    return item || "";
  };

  /**
   * Reset history navigation (back to current input)
   */
  const reset = (): void => {
    setCurrentIndex(-1);
  };

  /**
   * Store the current unsaved input
   */
  const storeCurrentInput = (input: string): void => {
    setCurrentInput(input);
  };

  /**
   * Get current navigation state
   */
  const getState = () => ({
    items: items(),
    currentIndex: currentIndex(),
    currentInput: currentInput(),
    canGoBack: currentIndex() < items().length - 1,
    canGoForward: currentIndex() > -1,
    isNavigating: currentIndex() !== -1,
  });

  /**
   * Clear all history
   */
  const clear = (): void => {
    setItems([]);
    setCurrentIndex(-1);
    setCurrentInput("");
  };

  return {
    addItem,
    goBack,
    goForward,
    reset,
    storeCurrentInput,
    getState,
    clear,
  };
}
