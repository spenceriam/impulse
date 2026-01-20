import { createSignal } from "solid-js";

/**
 * Paste Event Handler
 * Detects and handles multi-line paste events
 */

export interface PasteEvent {
  content: string;
  isPaste: boolean;
  lineCount: number;
  isImage?: boolean;
  imageIndex?: number;
}

const PASTE_THRESHOLD_MS = 100;

export function usePasteHandler() {
  const [pasteIndicator, setPasteIndicator] = createSignal<string | null>(null);
  const [imageCount, setImageCount] = createSignal<number>(0);

  let lastKeyPressTime = 0;
  let pendingPasteTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Handle input change - detect paste vs typing
   */
  const handleInput = (value: string, previousValue: string): PasteEvent => {
    const now = Date.now();
    const timeSinceLastKey = now - lastKeyPressTime;

    // If large amount of text added quickly, it's likely a paste
    const lineCount = (value.match(/\n/g) || []).length + 1;
    const addedLines = value.length - previousValue.length;
    const likelyPaste = addedLines > 20 || (addedLines > 3 && timeSinceLastKey < PASTE_THRESHOLD_MS);

    if (likelyPaste) {
      const indicator = `[Pasted ~${lineCount} lines]`;
      setPasteIndicator(indicator);

      if (pendingPasteTimeout) {
        clearTimeout(pendingPasteTimeout);
      }

      pendingPasteTimeout = setTimeout(() => {
        setPasteIndicator(null);
      }, 3000);
    }

    lastKeyPressTime = now;

    return {
      content: value,
      isPaste: likelyPaste,
      lineCount,
    };
  };

  /**
   * Handle image paste
   */
  const handleImagePaste = (): PasteEvent => {
    setImageCount((count) => count + 1);
    const currentCount = imageCount() + 1;

    const indicator = `[Image ${currentCount}]`;
    setPasteIndicator(indicator);

    if (pendingPasteTimeout) {
      clearTimeout(pendingPasteTimeout);
    }

    pendingPasteTimeout = setTimeout(() => {
      setPasteIndicator(null);
    }, 3000);

    return {
      content: "",
      isPaste: true,
      lineCount: 0,
      isImage: true,
      imageIndex: currentCount,
    };
  };

  /**
   * Get current paste indicator
   */
  const getIndicator = () => pasteIndicator();

  /**
   * Clear paste indicator manually
   */
  const clearIndicator = () => {
    setPasteIndicator(null);
  };

  return {
    handleInput,
    handleImagePaste,
    getIndicator,
    clearIndicator,
    imageCount: () => imageCount(),
  };
}
