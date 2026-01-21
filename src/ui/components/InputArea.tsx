import { createSignal, Show, For, createMemo } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { TextareaRenderable, PasteEvent } from "@opentui/core";
import { Colors, Mode, Layout } from "../design";
import { CommandRegistry } from "../../commands/registry";

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
 * 
 * Props:
 * - mode: Current mode (AUTO, AGENT, PLANNER, PLAN-PRD, DEBUG)
 * - thinking: Whether thinking mode is enabled
 * - onSubmit: Callback when user presses Enter to submit
 */

// Key bindings for textarea: Enter=submit, Shift+Enter=newline
// Type matches TextareaAction from @opentui/core
const TEXTAREA_KEY_BINDINGS = [
  { name: "return", action: "submit" as const },
  { name: "return", shift: true, action: "newline" as const },
];

// Fixed width for command column in autocomplete (for alignment)
const COMMAND_COL_WIDTH = 12;

interface InputAreaProps {
  mode: Mode;
  thinking: boolean;
  onSubmit?: (value: string) => void;
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
    <box flexDirection="column">
      {/* Floating autocomplete dropdown - above input box */}
      <Show when={showAutocomplete()}>
        <box
          border
          borderColor={Colors.ui.dim}
          flexDirection="column"
          backgroundColor="#1a1a1a"
        >
          <scrollbox height={Math.min(10, filteredCommands().length + 1)}>
            <box flexDirection="column">
              <For each={filteredCommands()}>
                {(cmd, index) => {
                  const isSelected = () => index() === selectedIndex();
                  return (
                    <Show
                      when={isSelected()}
                      fallback={
                        <box flexDirection="row" height={1}>
                          <text fg={Colors.ui.text}>
                            {` /${cmd.name.padEnd(COMMAND_COL_WIDTH)}`}
                          </text>
                          <text fg={Colors.ui.dim} wrapMode="none">
                            {cmd.description}
                          </text>
                        </box>
                      }
                    >
                      <box flexDirection="row" height={1} backgroundColor={Colors.mode.AGENT}>
                        <text fg="#000000">
                          {` /${cmd.name.padEnd(COMMAND_COL_WIDTH)}`}
                        </text>
                        <text fg="#000000" wrapMode="none">
                          {cmd.description}
                        </text>
                      </box>
                    </Show>
                  );
                }}
              </For>
            </box>
          </scrollbox>
          <box height={1} paddingLeft={1}>
            <text fg={Colors.ui.dim}>Tab: complete | Enter: select | Esc: close</text>
          </box>
        </box>
      </Show>
      
      {/* Input box */}
      <box
        border
        title={title()}
        titleAlignment="left"
        flexDirection="column"
        padding={1}
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
            focused
          />
        </box>
      </box>
    </box>
  );
}
