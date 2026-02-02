import { createSignal, createMemo, createEffect, Show } from "solid-js";
import { useAppKeyboard } from "../context/keyboard";
import type { TextareaRenderable, PasteEvent } from "@opentui/core";
import { t, italic, fg } from "@opentui/core";
import { Colors, Mode, Layout, getModeColor } from "../design";
import { CommandRegistry } from "../../commands/registry";
import { copy as copyToClipboard } from "../../util/clipboard";
import { getModelDisplayName } from "../../constants";

/**
 * Pasted content tracking
 */
interface PastedContent {
  type: "text" | "image";
  indicator: string;  // Display text like "[Pasted ~5 lines]" or "[Pasted image pasted_image_01-23-2026_1530]"
  timestamp: number;
}

// Track image paste counts for same-minute deduplication
const imagePasteCounts = new Map<string, number>();

/**
 * Generate image filename for pasted images without source
 * Format: pasted_image_MM-DD-YYYY_HHMM[-N]
 */
function generateImageFilename(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const year = now.getFullYear();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  
  const baseKey = `${month}-${day}-${year}_${hours}${minutes}`;
  const count = imagePasteCounts.get(baseKey) ?? 0;
  imagePasteCounts.set(baseKey, count + 1);
  
  if (count === 0) {
    return `pasted_image_${baseKey}`;
  } else {
    return `pasted_image_${baseKey}-${count}`;
  }
}


/**
 * Input Area Component
 * Boxed input with mode in title, ghost text, and multi-line support
 * 
 * Features:
 * - Multi-line text input via textarea
 * - Paste support via onPaste (inherits from Renderable)
 * - Undo/redo via Shift+Ctrl+Z / Shift+Ctrl+Y
 * - Enter to submit, Shift+Enter for newline
 * - Floating autocomplete for slash commands
 * - Loading spinner when AI is processing
 * 
 * Props:
 * - mode: Current mode (AUTO, EXPLORE, AGENT, PLANNER, PLAN-PRD, DEBUG)
 * - thinking: Whether thinking mode is enabled
 * - loading: Whether AI is currently processing
 * - onSubmit: Callback when user presses Enter to submit
 */

// Key bindings for textarea: Enter=submit, Shift+Enter=newline
// Type matches TextareaAction from @opentui/core
const TEXTAREA_KEY_BINDINGS = [
  { name: "return", action: "submit" as const },
  { name: "return", shift: true, action: "newline" as const },
];

export interface CommandCandidate {
  name: string;
  description: string;
}

interface InputAreaProps {
  mode: Mode;
  model: string;  // Current model name (e.g., "glm-4.7", "glm-4.6v")
  thinking: boolean;
  loading?: boolean;
  overlayActive?: boolean;  // When true, unfocus input (overlay is showing)
  fixedHeight?: number;  // Fixed height for textarea content (overrides Layout.input.minHeight)
  copiedIndicator?: boolean;  // Show "Copied" indicator in upper-right
  onSubmit?: (value: string) => void;
  onAutocompleteChange?: (data: { commands: CommandCandidate[]; selectedIndex: number } | null) => void;
  onCopy?: ((text: string) => void) | undefined;  // Called when user copies prompt text via Shift+Ctrl+C
}

// Maximum history entries to keep
const MAX_HISTORY = 50;

export function InputArea(props: InputAreaProps) {
  const [value, setValue] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [hasEverTyped, setHasEverTyped] = createSignal(false);
  
  // Prompt history for up/down navigation
  const [history, setHistory] = createSignal<string[]>([]);
  const [historyIndex, setHistoryIndex] = createSignal(-1); // -1 = current input, 0+ = history
  const [savedInput, setSavedInput] = createSignal(""); // Save current input when navigating history
  
  // Double-ESC tracking for clear functionality
  const [lastEscTime, setLastEscTime] = createSignal(0);
  const DOUBLE_ESC_THRESHOLD = 500; // ms
  
  // Pasted content tracking - shows indicator for text/image pastes
  const [pastedContent, setPastedContent] = createSignal<PastedContent | null>(null);
  let pasteIndicatorTimeout: ReturnType<typeof setTimeout> | null = null;
  
  // Timing-based paste detection (backup for when onPaste doesn't fire)
  let lastContentLength = 0;
  let lastContentChangeTime = 0;
  const PASTE_THRESHOLD_CHARS = 20;  // Consider paste if >20 chars added at once
  const PASTE_THRESHOLD_MS = 100;    // ...or >3 chars in <100ms
  
  let textareaRef: TextareaRenderable | undefined;

  // Ghost text: darker (#444444) and italic for subtle appearance
  const GHOST_COLOR = "#444444";
  const ghostText = t`${fg(GHOST_COLOR)(italic("What are we building, breaking, or making better?"))}`;
  
  // Ghost text only shows on first render, before user has ever typed
  const showGhostText = () => !hasEverTyped() && value().length === 0;

  // Get filtered commands based on current input
  const filteredCommands = createMemo(() => {
    const val = value();
    if (!val.startsWith("/")) return [];
    
    const search = val.slice(1).toLowerCase(); // Remove / prefix
    const allCommands = CommandRegistry.list();
    
    if (!search) {
      // Just "/" typed - show all commands
      return allCommands;
    }
    
    // Filter commands that match the typed text
    return allCommands.filter(cmd => 
      cmd.name.toLowerCase().startsWith(search)
    );
  });

  // Show autocomplete when input starts with / and there are matches
  // Stays open even when user types a complete command name
  const showAutocomplete = createMemo(() => {
    const val = value().trim();
    if (!val.startsWith("/")) return false;
    
    // Don't show autocomplete if there are args (space after command)
    const afterSlash = val.slice(1);
    if (afterSlash.includes(" ")) return false;
    
    const commands = filteredCommands();
    return commands.length > 0;
  });
  
  // Notify parent of autocomplete state changes for overlay rendering
  createEffect(() => {
    if (showAutocomplete()) {
      props.onAutocompleteChange?.({
        commands: filteredCommands(),
        selectedIndex: selectedIndex(),
      });
    } else {
      props.onAutocompleteChange?.(null);
    }
  });
  
  // Track previous overlayActive state to detect when overlay closes
  let prevOverlayActive = props.overlayActive ?? false;
  createEffect(() => {
    const currentOverlayActive = props.overlayActive ?? false;
    // When overlay just closed (was active, now not), force focus
    if (prevOverlayActive && !currentOverlayActive && textareaRef) {
      // Use setTimeout to ensure DOM has updated
      setTimeout(() => {
        textareaRef?.focus?.();
      }, 0);
    }
    prevOverlayActive = currentOverlayActive;
  });

  useAppKeyboard((key) => {
    // Skip all keyboard handling when overlay is active
    // This prevents history navigation from interfering with overlay navigation
    if (props.overlayActive) {
      return;
    }
    
    // Handle autocomplete navigation (takes priority)
    if (showAutocomplete()) {
      const commands = filteredCommands();
      
      if (key.name === "up") {
        setSelectedIndex(prev => Math.max(0, prev - 1));
        return;
      }
      
      if (key.name === "down") {
        setSelectedIndex(prev => Math.min(commands.length - 1, prev + 1));
        return;
      }
      
      if (key.name === "tab") {
        // Tab to complete the selected command
        const selected = commands[selectedIndex()];
        if (selected && textareaRef) {
          textareaRef.clear();
          textareaRef.insertText(`/${selected.name} `);
          setValue(`/${selected.name} `);
          setSelectedIndex(0);
        }
        return;
      }
      
      if (key.name === "escape") {
        // Close autocomplete by clearing selection
        setSelectedIndex(0);
        return;
      }
    }
    
    // Double-ESC to clear prompt (when not processing and not in autocomplete)
    if (key.name === "escape" && !props.loading) {
      const now = Date.now();
      const lastTime = lastEscTime();
      setLastEscTime(now);
      
      if (now - lastTime < DOUBLE_ESC_THRESHOLD && value().length > 0) {
        // Double-ESC detected - clear the prompt
        if (textareaRef) {
          textareaRef.clear();
        }
        setValue("");
        setHistoryIndex(-1);
        setSavedInput("");
        return;
      }
    }
    
    // History navigation with up/down arrows (when cursor is at appropriate position)
    // Only activate when not in autocomplete mode
    if (!showAutocomplete() && textareaRef) {
      const cursorAtStart = textareaRef.cursorOffset === 0;
      const cursorAtEnd = textareaRef.cursorOffset === textareaRef.plainText.length;
      const historyList = history();
      
      // Up arrow: go back in history (when cursor at start or input is empty)
      if (key.name === "up" && (cursorAtStart || value().length === 0)) {
        if (historyList.length > 0) {
          const currentIdx = historyIndex();
          
          // Save current input if we're starting to navigate
          if (currentIdx === -1) {
            setSavedInput(value());
          }
          
          // Move back in history
          const newIdx = Math.min(currentIdx + 1, historyList.length - 1);
          if (newIdx !== currentIdx || currentIdx === -1) {
            setHistoryIndex(newIdx);
            const historyItem = historyList[newIdx];
            if (historyItem !== undefined) {
              textareaRef.clear();
              textareaRef.insertText(historyItem);
              setValue(historyItem);
              textareaRef.gotoBufferEnd();
            }
          }
          return;
        }
      }
      
      // Down arrow: go forward in history or back to current input
      if (key.name === "down" && (cursorAtEnd || value().length === 0)) {
        const currentIdx = historyIndex();
        
        if (currentIdx > 0) {
          // Move forward in history
          const newIdx = currentIdx - 1;
          setHistoryIndex(newIdx);
          const historyItem = historyList[newIdx];
          if (historyItem !== undefined) {
            textareaRef.clear();
            textareaRef.insertText(historyItem);
            setValue(historyItem);
            textareaRef.gotoBufferEnd();
          }
          return;
        } else if (currentIdx === 0) {
          // Return to saved input
          setHistoryIndex(-1);
          const saved = savedInput();
          textareaRef.clear();
          if (saved) {
            textareaRef.insertText(saved);
            setValue(saved);
          } else {
            setValue("");
          }
          textareaRef.gotoBufferEnd();
          return;
        }
      }
    }

    // Undo: Shift+Ctrl+Z (Ctrl+Z is captured by terminal)
    if (key.ctrl && key.shift && key.name === "z") {
      if (textareaRef) {
        textareaRef.undo();
      }
      return;
    }

    // Redo: Shift+Ctrl+Y
    if (key.ctrl && key.shift && key.name === "y") {
      if (textareaRef) {
        textareaRef.redo();
      }
      return;
    }
    
    // Copy prompt text: Shift+Ctrl+C
    // Only copy if there's text in the prompt box
    if (key.ctrl && key.shift && key.name === "c") {
      const text = value().trim();
      if (text) {
        copyToClipboard(text);
        // Notify parent so it can show "Copied" indicator
        props.onCopy?.(text);
      }
      return;
    }
  });

  // Handle content changes from textarea (following OpenCode pattern)
  // Read from ref, not from callback param
  // Also includes timing-based paste detection as backup when onPaste doesn't fire
  const handleContentChange = () => {
    if (textareaRef) {
      const newValue = textareaRef.plainText;
      const now = Date.now();
      
      // Detect paste by checking if large amount of text was added quickly
      const charsAdded = newValue.length - lastContentLength;
      const timeSinceLastChange = now - lastContentChangeTime;
      
      // Likely a paste if:
      // - More than 20 chars added at once, OR
      // - More than 3 chars added in less than 100ms
      const likelyPaste = charsAdded > PASTE_THRESHOLD_CHARS || 
                          (charsAdded > 3 && timeSinceLastChange < PASTE_THRESHOLD_MS);
      
      if (likelyPaste && charsAdded > 0 && !pastedContent()) {
        // Count lines in the pasted content
        const lineCount = (newValue.match(/\n/g)?.length ?? 0) + 1;
        
        // Only show indicator for substantial pastes (>= 3 lines or > 150 chars)
        if (lineCount >= 3 || charsAdded > 150) {
          if (pasteIndicatorTimeout) {
            clearTimeout(pasteIndicatorTimeout);
          }
          
          setPastedContent({
            type: "text",
            indicator: `[Pasted ~${lineCount} lines]`,
            timestamp: now,
          });
          
          // Clear indicator after 5 seconds
          pasteIndicatorTimeout = setTimeout(() => {
            setPastedContent(null);
          }, 5000);
        }
      }
      
      // Update tracking variables for next change
      lastContentLength = newValue.length;
      lastContentChangeTime = now;
      
      setValue(newValue);
      // Mark that user has typed (never show ghost text again)
      if (newValue.length > 0) {
        setHasEverTyped(true);
      }
      // Reset selection when input changes
      setSelectedIndex(0);
    }
  };

  // Add submitted prompt to history
  const addToHistory = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    
    setHistory(prev => {
      // Don't add duplicates at the top
      if (prev[0] === trimmed) return prev;
      
      // Add to front, limit size
      const newHistory = [trimmed, ...prev].slice(0, MAX_HISTORY);
      return newHistory;
    });
    
    // Reset history navigation state
    setHistoryIndex(-1);
    setSavedInput("");
  };

  // Handle submit via textarea's onSubmit (triggered by Enter)
  const handleSubmit = () => {
    // If autocomplete is showing and user presses Enter, complete and submit the command
    if (showAutocomplete()) {
      const commands = filteredCommands();
      const selected = commands[selectedIndex()];
      if (selected) {
        const commandText = `/${selected.name}`;
        // Submit the completed command directly
        addToHistory(commandText);
        props.onSubmit?.(commandText);
        setValue("");
        if (textareaRef) {
          textareaRef.clear();
        }
        setSelectedIndex(0);
        return;
      }
    }
    
    if (value().trim()) {
      addToHistory(value());
      props.onSubmit?.(value());
      setValue("");
      if (textareaRef) {
        textareaRef.clear();
      }
    }
  };

  // Handle paste - show indicator with line count (for large pastes) or image filename
  const handlePaste = (event: PasteEvent) => {
    // Clear any existing timeout
    if (pasteIndicatorTimeout) {
      clearTimeout(pasteIndicatorTimeout);
    }
    
    // Check if this is an image paste (OpenTUI passes image data differently)
    // For now, we detect images by checking if text is empty but event fired
    const pastedText = event.text ?? "";
    
    if (pastedText.length > 0) {
      // Text paste - count lines (matching OpenCode: only show for >= 3 lines OR > 150 chars)
      const lineCount = (pastedText.match(/\n/g)?.length ?? 0) + 1;
      
      if (lineCount >= 3 || pastedText.length > 150) {
        const indicator = `[Pasted ~${lineCount} lines]`;
        
        setPastedContent({
          type: "text",
          indicator,
          timestamp: Date.now(),
        });
        
        // Clear indicator after 5 seconds
        pasteIndicatorTimeout = setTimeout(() => {
          setPastedContent(null);
        }, 5000);
      }
      // Small pastes (< 3 lines AND <= 150 chars) don't show indicator
    } else {
      // Possible image paste (no text content)
      const filename = generateImageFilename();
      setPastedContent({
        type: "image",
        indicator: `[Pasted image ${filename}]`,
        timestamp: Date.now(),
      });
      
      // Clear indicator after 5 seconds
      pasteIndicatorTimeout = setTimeout(() => {
        setPastedContent(null);
      }, 5000);
    }
    
    // After paste completes, move cursor to end of buffer
    setTimeout(() => {
      if (textareaRef) {
        textareaRef.gotoBufferEnd();
      }
    }, 0);
  };

  // Get the mode color for accent lines
  const modeColor = () => getModeColor(props.mode);
  
  // Mode label text: MODE > MODEL (thinking indicator)
  const modeLabel = () => {
    const thinkingSuffix = props.thinking ? " (Thinking)" : "";
    const modelName = getModelDisplayName(props.model);
    return ` ${props.mode} > ${modelName}${thinkingSuffix} `;
  };

  return (
    <box
      flexDirection="column"
      backgroundColor={Colors.input.background}
      minWidth={0}           // Allow shrinking in flex layout
      overflow="hidden"      // Clip content at bounds
      width="100%"
    >
      {/* Top accent line - thin line using lower half block character */}
      <box height={1} width="100%" overflow="hidden">
        <text fg={modeColor()}>{"▄".repeat(300)}</text>
      </box>
      
      {/* Mode label row - separate from accent line for cleaner layout */}
      <box height={1} paddingLeft={1} flexDirection="row">
        <text fg={modeColor()}>{modeLabel()}</text>
        <box flexGrow={1} />
        {/* Copied indicator - shows briefly when message copied to clipboard */}
        <Show when={props.copiedIndicator}>
          <box flexShrink={0} paddingRight={1}>
            <text fg={Colors.status.success}>Copied</text>
          </box>
        </Show>
      </box>
      
      {/* Main content area with padding */}
      <box flexDirection="column" paddingLeft={1} paddingRight={1}>
        {/* Paste indicator - shows when content was just pasted */}
        <Show when={pastedContent()}>
          {(content: () => PastedContent) => (
            <box height={1} marginBottom={1}>
              <text fg={Colors.ui.dim}>{content().indicator}</text>
            </box>
          )}
        </Show>
        
        {/* Row container with minWidth={0} for proper flex shrinking */}
        <box flexDirection="row" alignItems="flex-start" minWidth={0}>
          {/* Fixed-width prompt indicator */}
          <box width={2} flexShrink={0}>
            <text fg={Colors.ui.dim}>{">"} </text>
          </box>
          {/* Textarea fills remaining space, minWidth={0} allows shrinking */}
          <box flexGrow={1} minWidth={0}>
            <textarea
              ref={(r: TextareaRenderable) => { textareaRef = r; }}
              keyBindings={TEXTAREA_KEY_BINDINGS}
              onContentChange={handleContentChange}
              onSubmit={handleSubmit}
              onPaste={handlePaste}
              placeholder={showGhostText() ? ghostText : null}
              width={-1}
              height={props.fixedHeight ?? Layout.input.minHeight}
              focused={!props.overlayActive}
              cursorColor={Colors.ui.primary}
            />
          </box>
        </box>
      </box>
      
      {/* Bottom accent line - thin line using upper half block character */}
      <box height={1} width="100%" overflow="hidden">
        <text fg={modeColor()}>{"▀".repeat(300)}</text>
      </box>
    </box>
  );
}
