import { createSignal, createMemo, createEffect } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { TextareaRenderable, PasteEvent } from "@opentui/core";
import { Colors, Mode, Layout } from "../design";
import { CommandRegistry } from "../../commands/registry";

// Background color for input area (dark purple tint per design spec)
const INPUT_BACKGROUND = "#1a1a2a";


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
 * - mode: Current mode (AUTO, AGENT, PLANNER, PLAN-PRD, DEBUG)
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
  thinking: boolean;
  loading?: boolean;
  onSubmit?: (value: string) => void;
  onAutocompleteChange?: (data: { commands: CommandCandidate[]; selectedIndex: number } | null) => void;
}

export function InputArea(props: InputAreaProps) {
  const [value, setValue] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [hasEverTyped, setHasEverTyped] = createSignal(false);
  let textareaRef: TextareaRenderable | undefined;

  const ghostText = "What are we building, breaking, or making better?";
  
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

  useKeyboard((key) => {
    // Handle autocomplete navigation
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
        // Close autocomplete by clearing
        setSelectedIndex(0);
        return;
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
  });

  // Handle content changes from textarea (following OpenCode pattern)
  // Read from ref, not from callback param
  const handleContentChange = () => {
    if (textareaRef) {
      const newValue = textareaRef.plainText;
      setValue(newValue);
      // Mark that user has typed (never show ghost text again)
      if (newValue.length > 0) {
        setHasEverTyped(true);
      }
      // Reset selection when input changes
      setSelectedIndex(0);
    }
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
      props.onSubmit?.(value());
      setValue("");
      if (textareaRef) {
        textareaRef.clear();
      }
    }
  };

  // Handle paste - normalize line endings and move cursor to end
  const handlePaste = (_event: PasteEvent) => {
    // Textarea's built-in handlePaste inserts the text
    // After paste completes, move cursor to end of buffer
    // Use setTimeout to ensure paste is processed first
    setTimeout(() => {
      if (textareaRef) {
        textareaRef.gotoBufferEnd();
      }
    }, 0);
  };

  const title = () => {
    const thinkingSuffix = props.thinking ? " (Thinking)" : "";
    return `${props.mode}${thinkingSuffix}`;
  };

  return (
    <box
      border
      title={title()}
      titleAlignment="left"
      flexDirection="column"
      padding={1}
      backgroundColor={INPUT_BACKGROUND}
    >
      <box flexDirection="row" alignItems="flex-start">
        <text fg={Colors.ui.dim}>{">"} </text>
        <textarea
          ref={(r: TextareaRenderable) => { textareaRef = r; }}
          keyBindings={TEXTAREA_KEY_BINDINGS}
          onContentChange={handleContentChange}
          onSubmit={handleSubmit}
          onPaste={handlePaste}
          placeholder={showGhostText() ? ghostText : ""}
          width={-1}
          height={Layout.input.minHeight}
          focused={!props.loading}
          cursorColor={Colors.ui.primary}
        />
      </box>
    </box>
  );
}
