import { createSignal, createEffect, Show, onMount, onCleanup, For } from "solid-js";
import { useRenderer, useKeyboard, useTerminalDimensions } from "@opentui/solid";
import type { PasteEvent } from "@opentui/core";
import { StatusLine, HeaderLine, InputArea, ChatView, BottomPanel, QuestionOverlay, PermissionPrompt, ExpressWarning, SessionPickerOverlay, StartOverlay, TodoOverlay, Gutter, GUTTER_WIDTH, type CommandCandidate, type CompactingState } from "./components";
import { ModeProvider, useMode } from "./context/mode";
import { SessionProvider, useSession } from "./context/session";
import { TodoProvider } from "./context/todo";
// Sidebar removed - todos now in BottomPanel
import { ExpressProvider, useExpress } from "./context/express";
import { respond as respondPermission, type PermissionRequest, type PermissionResponse } from "../permission";
import { load as loadConfig, save as saveConfig } from "../util/config";
import { GLMClient } from "../api/client";
import { StreamProcessor, StreamEvent } from "../api/stream";
import { Colors, Timing } from "./design";
import { batch as batchUpdate, flushBatch } from "../util/batch";
import { CommandRegistry } from "../commands/registry";
import { registerCoreCommands } from "../commands/core";
import { registerUtilityCommands } from "../commands/utility";
import { registerInfoCommands } from "../commands/info";
import { registerInitCommand } from "../commands/init";
import { GLM_MODELS, MODES } from "../constants";
import { generateSystemPrompt } from "../agent/prompts";
import { Bus } from "../bus";
import { resolveQuestion, rejectQuestion, type Question } from "../tools/question";
import { Tool } from "../tools/registry";
import { setCurrentMode } from "../tools/mode-state";
import { type ToolCallInfo } from "./components/MessageBlock";
import { registerMCPTools, mcpManager } from "../mcp";
import packageJson from "../../package.json";
import { runUpdateCheck, type UpdateState } from "../util/update-check";
import { enableDebugLog, isDebugEnabled, logUserMessage, logToolExecution, logAPIRequest, logError, logRawAPIMessages } from "../util/debug-log";
import { copy as copyToClipboard } from "../util/clipboard";
import { addToClipboardHistory } from "../util/clipboard-history";

/**
 * Join content sections with normalized whitespace.
 * Prevents excessive blank lines (max 2 consecutive newlines).
 */
function joinContentSections(base: string, addition: string): string {
  if (!base) return addition;
  if (!addition) return base;
  
  // Trim trailing whitespace from base, leading whitespace from addition
  const trimmedBase = base.trimEnd();
  const trimmedAddition = addition.trimStart();
  
  if (!trimmedBase) return trimmedAddition;
  if (!trimmedAddition) return trimmedBase;
  
  // Join with double newline (paragraph break)
  return trimmedBase + "\n\n" + trimmedAddition;
}

/**
 * App Component
 * Root OpenTUI component with full-screen layout and context providers
 * 
 * Flow:
 * 1. Check for API key synchronously from env var first
 * 2. If no env var, check config file
 * 3. If no API key found, show overlay prompt (not a separate screen)
 * 4. Once API key is set, show welcome screen / session view
 */

// API Key prompt as an overlay (not a full screen replacement)
function ApiKeyOverlay(props: { onSave: (key: string) => void; onCancel: () => void }) {
  const [apiKey, setApiKey] = createSignal("");
  const [error, setError] = createSignal("");

  // Handle Escape to cancel (global keyboard since input captures most keys)
  useKeyboard((key) => {
    if (key.name === "escape") {
      props.onCancel();
    }
  });

  // Handle input changes
  const handleInput = (newValue: string) => {
    setApiKey(newValue);
    setError("");
  };

  // Handle Enter via input's onSubmit
  const handleSubmit = (value: string) => {
    const trimmedKey = value.trim();
    if (trimmedKey) {
      if (trimmedKey.length < 10) {
        setError("API key seems too short. Please check and try again.");
        return;
      }
      setError("");
      props.onSave(trimmedKey);
    }
  };

  // Handle paste - onPaste exists on base Renderable
  const handlePaste = (event: PasteEvent) => {
    const cleanText = event.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "").trim();
    if (cleanText) {
      setApiKey(cleanText);
      setError("");
    }
  };

  return (
    <box
      position="absolute"
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <box
        border
        title="Welcome to IMPULSE"
        flexDirection="column"
        padding={2}
        width={74}
        backgroundColor="#1a1a1a"
      >
        <text fg={Colors.ui.text}>
          IMPULSE is powered by Z.ai's Coding Plan - the best cost/engineering
        </text>
        <text fg={Colors.ui.text}>
          ratio for builders.
        </text>
        <box height={1} />
        <box flexDirection="row" flexWrap="wrap">
          <text fg={Colors.ui.text}>To get started, you'll need a </text>
          <text fg={Colors.mode.AGENT}>Coding Plan API key</text>
          <text fg={Colors.ui.text}> from Z.ai.</text>
        </box>
        <text fg={Colors.ui.dim}>
          (This is different from the standard Z.ai API key)
        </text>
        <box height={1} />
        <box flexDirection="row">
          <text fg={Colors.ui.dim}>Get your key at: </text>
          <text fg={Colors.mode.AGENT}>https://z.ai/manage-apikey/subscription</text>
        </box>
        <box height={1} />
        <box flexDirection="row">
          <text fg={Colors.ui.text}>API Key: </text>
          <input
            value={apiKey()}
            onInput={handleInput}
            onSubmit={handleSubmit}
            onPaste={handlePaste}
            focused
            width={50}
          />
        </box>
        <Show when={error()}>
          <box height={1} />
          <text fg={Colors.status.error}>{error()}</text>
        </Show>
        <box height={1} />
        <text fg={Colors.ui.dim}>
          Enter to save | Esc to exit
        </text>
      </box>
    </box>
  );
}

// Command result overlay (shows command output without creating messages)
// Uses scrollbox for long content like /help
const OVERLAY_MAX_HEIGHT = 24;  // Max visible rows for content

function CommandResultOverlay(props: { 
  title: string;
  content: string; 
  isError?: boolean;
  onClose: () => void;
}) {
  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "return") {
      props.onClose();
    }
  });

  // Count content lines to determine if scrolling needed
  const contentLines = props.content.split("\n").length;
  const needsScroll = contentLines > OVERLAY_MAX_HEIGHT;
  // Use wider width for help content
  const isHelp = props.title.toLowerCase().includes("help");
  const overlayWidth = isHelp ? 85 : 70;

  return (
    <box
      position="absolute"
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <box
        border
        title={props.title}
        flexDirection="column"
        padding={1}
        width={overlayWidth}
        backgroundColor="#1a1a1a"
      >
        <Show
          when={needsScroll}
          fallback={
            <text fg={props.isError ? Colors.status.error : Colors.ui.text}>
              {props.content}
            </text>
          }
        >
          <scrollbox
            height={OVERLAY_MAX_HEIGHT}
            style={{
              scrollbarOptions: {
                trackOptions: {
                  foregroundColor: Colors.mode.AGENT,
                  backgroundColor: Colors.ui.dim,
                },
              },
              viewportOptions: {
                paddingRight: 1,
              },
            }}
          >
            <text fg={props.isError ? Colors.status.error : Colors.ui.text}>
              {props.content}
            </text>
          </scrollbox>
        </Show>
        <box height={1} />
        <text fg={Colors.ui.dim}>
          {needsScroll ? "↑/↓: scroll | Enter/Esc: close" : "Press Enter or Esc to close"}
        </text>
      </box>
    </box>
  );
}

// Model info with description and input type
interface ModelInfo {
  description: string;
  input: "text" | "text + vision";
}

const MODEL_INFO: Record<string, ModelInfo> = {
  "glm-4.7": { description: "Flagship model for complex coding and reasoning", input: "text" },
  "glm-4.7-flash": { description: "Fast variant of flagship model", input: "text" },
  "glm-4.6": { description: "Balanced performance and capability", input: "text" },
  "glm-4.6v": { description: "Multimodal with image understanding", input: "text + vision" },
  "glm-4.5": { description: "Efficient general-purpose model", input: "text" },
  "glm-4.5-air": { description: "Lightweight and fast responses", input: "text" },
  "glm-4.5-flash": { description: "Ultra-fast for simple tasks", input: "text" },
  "glm-4.5v": { description: "Quick multimodal image tasks", input: "text + vision" },
};

// Column widths for alignment
const MODEL_COL_WIDTH = 16;
const INPUT_COL_WIDTH = 14;
const CHECKBOX_COL_WIDTH = 5; // "[x] " or "[ ] "

// Model select overlay - interactive model selection
function ModelSelectOverlay(props: { 
  currentModel: string;
  onSelect: (model: string) => void;
  onCancel: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = createSignal(
    Math.max(0, GLM_MODELS.indexOf(props.currentModel as typeof GLM_MODELS[number]))
  );

  useKeyboard((key) => {
    if (key.name === "escape") {
      props.onCancel();
      return;
    }
    
    if (key.name === "up") {
      setSelectedIndex(i => Math.max(0, i - 1));
      return;
    }
    
    if (key.name === "down") {
      setSelectedIndex(i => Math.min(GLM_MODELS.length - 1, i + 1));
      return;
    }
    
    if (key.name === "return") {
      const model = GLM_MODELS[selectedIndex()];
      if (model) {
        props.onSelect(model);
      }
      return;
    }
  });

  return (
    <box
      position="absolute"
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <box
        border
        title="Select Model"
        flexDirection="column"
        padding={1}
        width={100}
        backgroundColor="#1a1a1a"
      >
        {/* Header row - same structure as data rows for alignment */}
        <box flexDirection="row">
          <text fg={Colors.ui.dim}>{" ".repeat(CHECKBOX_COL_WIDTH)}</text>
          <text fg={Colors.ui.dim}>{"MODEL".padEnd(MODEL_COL_WIDTH)}</text>
          <text fg={Colors.ui.dim}>{"INPUT".padEnd(INPUT_COL_WIDTH)}</text>
          <text fg={Colors.ui.dim}>{"DESCRIPTION"}</text>
        </box>
        <box height={1} />
        {/* Model rows */}
        <For each={[...GLM_MODELS]}>
          {(model, index) => {
            const isSelected = () => index() === selectedIndex();
            const isCurrent = model === props.currentModel;
            const info = MODEL_INFO[model] || { description: "", input: "text" };
            const displayName = model.toUpperCase();
            
            // Build the row content with proper alignment
            const checkbox = isCurrent ? "[x] " : "[ ] ";
            const nameCol = displayName.padEnd(MODEL_COL_WIDTH);
            const inputCol = info.input.padEnd(INPUT_COL_WIDTH);
            const desc = info.description;
            
            return (
              <Show
                when={isSelected()}
                fallback={
                  <box flexDirection="row">
                    <text fg={isCurrent ? Colors.status.success : Colors.ui.dim}>{checkbox}</text>
                    <text fg={Colors.ui.text}>{nameCol}</text>
                    <text fg={Colors.ui.dim}>{inputCol}</text>
                    <text fg={Colors.ui.dim}>{desc}</text>
                  </box>
                }
              >
                <box flexDirection="row" backgroundColor={Colors.mode.AGENT}>
                  <text fg={isCurrent ? "#006600" : "#333333"}>{checkbox}</text>
                  <text fg="#000000">{nameCol}</text>
                  <text fg="#000000">{inputCol}</text>
                  <text fg="#000000">{desc}</text>
                </box>
              </Show>
            );
          }}
        </For>
        <box height={1} />
        <text fg={Colors.ui.dim}>
          {" Up/Down: navigate | Enter: select | Esc: cancel"}
        </text>
      </box>
    </box>
  );
}

// Logo width is fixed (ASCII art)
const LOGO_WIDTH = 54; // Widest logo line
// Ideal box width - used when terminal is wide enough
const IDEAL_BOX_WIDTH = 78;
// Minimum width to show logo properly (logo + some padding + brackets)
const MIN_BOX_WIDTH = LOGO_WIDTH + 8;

// Welcome screen (shown when no messages)
function WelcomeScreen(props: { 
  onSubmit: (value: string) => void;
  onAutocompleteChange?: (data: { commands: { name: string; description: string }[]; selectedIndex: number } | null) => void;
  updateState?: UpdateState | null;
  onDismissUpdate?: () => void;
}) {
  const { mode, thinking } = useMode();
  const { model } = useSession();
  const dimensions = useTerminalDimensions();
  const terminalWidth = () => dimensions().width;

  // ASCII logo for IMPULSE - centered inside [[ ]] frame
  const logo = [
    "██╗███╗   ███╗██████╗ ██╗   ██╗██╗     ███████╗███████╗",
    "██║████╗ ████║██╔══██╗██║   ██║██║     ██╔════╝██╔════╝",
    "██║██╔████╔██║██████╔╝██║   ██║██║     ███████╗█████╗  ",
    "██║██║╚██╔╝██║██╔═══╝ ██║   ██║██║     ╚════██║██╔══╝  ",
    "██║██║ ╚═╝ ██║██║     ╚██████╔╝███████╗███████║███████╗",
    "╚═╝╚═╝     ╚═╝╚═╝      ╚═════╝ ╚══════╝╚══════╝╚══════╝",
  ];

  // Gradient colors from bright cyan to dim (per Design.md)
  const gradientColors = [
    "#5cffff", // Line 0 - brightest cyan
    "#4ad4d4", // Line 1
    "#38a9a9", // Line 2
    "#267e7e", // Line 3
    "#1a6666", // Line 4
    "#666666", // Line 5 - dim
  ];

  // Responsive box width - clamp between min and ideal, leave 4 char margin on each side
  const boxWidth = () => Math.max(MIN_BOX_WIDTH, Math.min(IDEAL_BOX_WIDTH, terminalWidth() - 8));
  
  // Calculate inner width and padding dynamically
  const innerWidth = () => boxWidth() - 4; // Inside [[ and ]]
  const logoPadding = () => Math.max(0, Math.floor((innerWidth() - LOGO_WIDTH) / 2));

  // Get version from package.json
  const version = `v${packageJson.version}`;
  // Build date: use current date formatted as MM-DD-YYYY
  const now = new Date();
  const buildDate = `built ${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${now.getFullYear()}`;
  const dir = process.cwd().replace(process.env["HOME"] || "", "~");

  // Top/bottom bracket lines: [[━━━━...━━━━]] - reactive to width changes
  const bracketLine = () => `[[${("━").repeat(innerWidth())}]]`;

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Logo section - centered with no flex grow, positioned from top */}
      <box flexDirection="column" alignItems="center" paddingTop={4}>
        {/* Custom frame with [[ ]] brackets */}
        <box flexDirection="column" width={boxWidth()}>
          {/* Top bracket line */}
          <text fg={Colors.ui.dim}>{bracketLine()}</text>
          
          {/* Empty line for padding */}
          <box height={1} />
          
          {/* Logo lines with gradient - centered with calculated padding */}
          {logo.map((line, i) => (
            <box flexDirection="row" justifyContent="center">
              <text fg={gradientColors[i] || Colors.ui.dim}>
                {" ".repeat(logoPadding())}{line}{" ".repeat(logoPadding())}
              </text>
            </box>
          ))}
          
          {/* Padding between logo and version info */}
          <box height={2} />
          
          {/* Version and build info - two columns centered under logo */}
          <box flexDirection="row" justifyContent="center">
            <box flexDirection="row" justifyContent="space-between" width={LOGO_WIDTH}>
              <text fg={Colors.ui.dim}>{version}</text>
              <text fg={Colors.ui.dim}>GLM-4.7</text>
            </box>
          </box>
          <box flexDirection="row" justifyContent="center">
            <box flexDirection="row" justifyContent="space-between" width={LOGO_WIDTH}>
              <text fg={Colors.ui.dim}>{buildDate}</text>
              <text fg={Colors.ui.dim}>{dir}</text>
            </box>
          </box>
          
          {/* Empty line for padding */}
          <box height={1} />
          
          {/* Bottom bracket line */}
          <text fg={Colors.ui.dim}>{bracketLine()}</text>
        </box>
        
        {/* Update notification - show between logo and prompt */}
        <Show when={props.updateState && props.updateState.status !== "checking"}>
          <box flexDirection="column" alignItems="center" paddingTop={2}>
            <box width={boxWidth()}>
              <Show when={props.updateState?.status === "installing"}>
                <box 
                  flexDirection="row" 
                  paddingLeft={1}
                  paddingRight={1}
                  height={1}
                  alignItems="center"
                  backgroundColor="#1a1a00"
                >
                  <text fg={Colors.status.warning}>Updating to {(props.updateState as { latestVersion: string }).latestVersion}...</text>
                </box>
              </Show>
              <Show when={props.updateState?.status === "installed"}>
                <box 
                  flexDirection="row" 
                  paddingLeft={1}
                  paddingRight={1}
                  height={1}
                  alignItems="center"
                  backgroundColor="#001a00"
                >
                  <text fg={Colors.status.success}>Updated to {(props.updateState as { latestVersion: string }).latestVersion}! Please restart IMPULSE to apply.</text>
                  <box flexGrow={1} />
                  <box onMouseDown={() => props.onDismissUpdate?.()}>
                    <text fg={Colors.ui.dim}>[X]</text>
                  </box>
                </box>
              </Show>
              <Show when={props.updateState?.status === "failed"}>
                <box 
                  flexDirection="row" 
                  paddingLeft={1}
                  paddingRight={1}
                  height={1}
                  alignItems="center"
                  backgroundColor="#1a0000"
                >
                  <text fg={Colors.status.error}>Update failed. Run: </text>
                  <text fg={Colors.ui.primary}>{(props.updateState as { updateCommand: string }).updateCommand}</text>
                  <box flexGrow={1} />
                  <box onMouseDown={() => props.onDismissUpdate?.()}>
                    <text fg={Colors.ui.dim}>[X]</text>
                  </box>
                </box>
              </Show>
            </box>
          </box>
        </Show>
        
        {/* Gap between logo box (or update notification) and prompt */}
        <box height={props.updateState ? 2 : 5} />
        
        {/* Input area positioned after the gap - responsive width to match logo box */}
        <box width={boxWidth()}>
          <Show 
            when={props.onAutocompleteChange}
            fallback={<InputArea mode={mode()} model={model()} thinking={thinking()} onSubmit={props.onSubmit} />}
          >
            <InputArea 
              mode={mode()} 
              model={model()}
              thinking={thinking()} 
              onSubmit={props.onSubmit}
              onAutocompleteChange={props.onAutocompleteChange!}
            />
          </Show>
        </box>
      </box>
      
      {/* Status line anchored below input - centered with same width */}
      <box flexDirection="column" alignItems="center">
        <box width={boxWidth()}>
          <StatusLine isInitialScreen />
        </box>
      </box>
    </box>
  );
}

// Initialize commands once (singleton pattern - safe to call multiple times)
let commandsRegistered = false;
function initializeCommands() {
  if (commandsRegistered) return;
  registerCoreCommands();
  registerUtilityCommands();
  registerInfoCommands();
  registerInitCommand();
  commandsRegistered = true;
}

// Initialize MCP tools (async, runs in background)
let mcpToolsRegistered = false;
async function initializeMCPTools() {
  if (mcpToolsRegistered) return;
  mcpToolsRegistered = true; // Set early to prevent duplicate calls
  try {
    await registerMCPTools();
  } catch (error) {
    console.error("Failed to register MCP tools:", error);
  }
}

// App props interface
interface AppProps {
  initialExpress?: boolean;
  initialModel?: string;
  initialMode?: "AUTO" | "EXPLORE" | "AGENT" | "PLANNER" | "PLAN-PRD" | "DEBUG";
  initialSessionId?: string;
  showSessionPicker?: boolean;
  verbose?: boolean;
}

// Main app wrapper
export function App(props: AppProps) {
  const renderer = useRenderer();
  
  // Register commands and MCP tools on mount
  onMount(async () => {
    initializeCommands();
    // MCP tools registered async in background (don't block UI)
    initializeMCPTools();
    
    // Enable debug logging if verbose flag is set
    if (props.verbose) {
      const logPath = await enableDebugLog();
      console.log(`Debug logging enabled: ${logPath}`);
    }
  });
  
  // Check for API key - env var first, then we'll check config
  const envApiKey = process.env["GLM_API_KEY"];
  
  const [hasApiKey, setHasApiKey] = createSignal<boolean>(!!envApiKey);
  const [showApiKeyOverlay, setShowApiKeyOverlay] = createSignal<boolean>(!envApiKey);
  const [configLoaded, setConfigLoaded] = createSignal<boolean>(!!envApiKey);

  // If no env var, check config file
  if (!envApiKey) {
    // Load config synchronously-ish using createEffect
    createEffect(async () => {
      if (configLoaded()) return;
      
      try {
        const cfg = await loadConfig();
        if (cfg.apiKey) {
          setHasApiKey(true);
          setShowApiKeyOverlay(false);
        }
      } catch {
        // Config load failed, will show API key prompt
      }
      setConfigLoaded(true);
    });
  }

  // Handle API key save from overlay
  const handleApiKeySave = async (key: string) => {
    try {
      const cfg = await loadConfig().catch(() => ({
        apiKey: key,
        defaultModel: "glm-4.7",
        defaultMode: "AUTO",
        thinking: true,
        hasSeenWelcome: false,
      }));
      cfg.apiKey = key;

      await saveConfig(cfg);
      setHasApiKey(true);
      setShowApiKeyOverlay(false);

      // Reset GLMClient to pick up new key
      GLMClient.reset();
      
      // Reset MCP manager to initialize with new API key
      mcpManager.resetForNewApiKey();
      mcpManager.ensureInitialized();
    } catch (error) {
      console.error("Failed to save API key:", error);
    }
  };

  // Handle cancel - exit app
  const handleApiKeyCancel = () => {
    renderer.destroy();
  };

  // Get terminal dimensions for explicit sizing (OpenCode pattern)
  // Using explicit numeric dimensions prevents layout calculation issues
  const dimensions = useTerminalDimensions();

  // Build provider props - only include defined values (exactOptionalPropertyTypes)
  const modeProviderProps = props.initialMode ? { initialMode: props.initialMode } : {};
  const sessionProviderProps = {
    ...(props.initialModel ? { initialModel: props.initialModel } : {}),
    ...(props.initialSessionId ? { initialSessionId: props.initialSessionId } : {}),
  };
  const appWithSessionProps = props.showSessionPicker ? { showSessionPicker: true } : {};

  // Show API key overlay if needed, otherwise show main app
  return (
    <ModeProvider {...modeProviderProps}>
      <SessionProvider {...sessionProviderProps}>
        <TodoProvider>
          <ExpressProvider initialExpress={props.initialExpress ?? false}>
            {/* Use explicit dimensions from terminal, not "100%" strings */}
            <box 
              width={dimensions().width} 
              height={dimensions().height} 
              padding={1}
            >
              <Show when={hasApiKey()}>
                <AppWithSession {...appWithSessionProps} />
              </Show>
              <Show when={!hasApiKey() && !showApiKeyOverlay()}>
                {/* Brief moment before overlay shows */}
                <WelcomeScreen onSubmit={() => {}} />
              </Show>
              <Show when={showApiKeyOverlay()}>
                <ApiKeyOverlay onSave={handleApiKeySave} onCancel={handleApiKeyCancel} />
              </Show>
            </box>
          </ExpressProvider>
        </TodoProvider>
      </SessionProvider>
    </ModeProvider>
  );
}

// Helper to format duration in human-readable form
function formatDuration(ms: number): string {
  const totalMins = Math.floor(ms / 60000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

/**
 * API Message types for proper conversation serialization
 * OpenAI-compatible format requires:
 * - system, user, assistant roles for normal messages
 * - assistant messages with tool_calls array when tools are invoked
 * - tool role messages with tool_call_id for each tool result
 */
type APIMessage = 
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; reasoning_content?: string; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; content: string; tool_call_id: string };

/**
 * Build API messages from UI messages with proper tool call serialization
 * 
 * This function handles the complex case where assistant messages may have tool calls.
 * The API expects:
 * 1. assistant message with tool_calls array
 * 2. tool messages with results (one per tool_call_id)
 * 3. Optional continuation assistant message (after tools complete)
 * 
 * UI messages are stored as separate Message objects, but we need to detect
 * when an assistant message with tool calls is followed by another assistant
 * message (the continuation) and NOT send them as back-to-back assistant messages.
 * 
 * Instead, the continuation becomes the "response after tool results" in the API format.
 */
function buildAPIMessages(
  uiMessages: Array<{ 
    id: string; 
    role: "user" | "assistant"; 
    content: string; 
    reasoning?: string;
    toolCalls?: ToolCallInfo[];
  }>,
  excludeMessageId?: string
): APIMessage[] {
  const apiMessages: APIMessage[] = [];
  const filtered = excludeMessageId 
    ? uiMessages.filter(m => m.id !== excludeMessageId)
    : uiMessages;
  
  for (const msg of filtered) {
    if (msg.role === "user") {
      apiMessages.push({
        role: "user",
        content: msg.content,
      });
    } else if (msg.role === "assistant") {
      // Check if this assistant message has tool calls
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        // Assistant message with tool calls
        const assistantMsg: APIMessage = {
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.toolCalls.map(tc => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          })),
        };
        
        // Include reasoning_content for preserved thinking
        if (msg.reasoning) {
          (assistantMsg as any).reasoning_content = msg.reasoning;
        }
        
        apiMessages.push(assistantMsg);
        
        // Add tool result messages
        for (const tc of msg.toolCalls) {
          apiMessages.push({
            role: "tool",
            content: tc.result || "",
            tool_call_id: tc.id,
          });
        }
        
        // Check if next message is also an assistant message (continuation after tools)
        // If so, we'll handle it as the response after tool results - which is correct API format
        // The next iteration will add it as a normal assistant message
      } else {
        // Regular assistant message without tool calls
        const assistantMsg: APIMessage = {
          role: "assistant",
          content: msg.content,
        };
        
        // Include reasoning_content for preserved thinking
        if (msg.reasoning) {
          (assistantMsg as any).reasoning_content = msg.reasoning;
        }
        
        apiMessages.push(assistantMsg);
      }
    }
  }
  
  return apiMessages;
}

// App that decides between welcome screen and session view
function AppWithSession(props: { showSessionPicker?: boolean }) {
  const { messages, addMessage, updateMessage, model, setModel, headerTitle, setHeaderTitle, headerPrefix, setHeaderPrefix, setVerboseTools, createNewSession, loadSession, stats, recordToolCall, addTokenUsage, ensureSessionCreated, saveAfterResponse, saveOnExit, isDirty } = useSession();
  const { mode, setMode, thinking, setThinking, cycleMode, cycleModeReverse } = useMode();
  const { express, showWarning, acknowledge: acknowledgeExpress, toggle: toggleExpress } = useExpress();
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();

  const [isLoading, setIsLoading] = createSignal(false);
  
  // Track if user has ever started a session (to keep session view after /clear or /new)
  const [hasStartedSession, setHasStartedSession] = createSignal(false);
  
  // Stream processor signal - needs to be a signal so keyboard handler can access current value
  const [streamProc, setStreamProc] = createSignal<StreamProcessor | null>(null);
  
  // ESC warning state - shows "Hit ESC again to stop" after first ESC
  const [escWarning, setEscWarning] = createSignal(false);
  
  // Ctrl+C warning state - shows "unsaved changes" warning
  const [ctrlCWarning, setCtrlCWarning] = createSignal(false);
  
  // Command result overlay state
  const [commandOverlay, setCommandOverlay] = createSignal<{
    title: string;
    content: string;
    isError: boolean;
  } | null>(null);
  
  // Model select overlay state
  const [showModelSelect, setShowModelSelect] = createSignal(false);
  
  // Session picker overlay state - initialize from props if provided via CLI (-c flag)
  const [showSessionPicker, setShowSessionPicker] = createSignal(props.showSessionPicker ?? false);
  
  // Question overlay state (from AI question tool)
  const [pendingQuestions, setPendingQuestions] = createSignal<{ context?: string; questions: Question[] } | null>(null);
  
  // Permission prompt state (from tool permission requests)
  const [pendingPermission, setPendingPermission] = createSignal<PermissionRequest | null>(null);
  
  // Command autocomplete state - lifted to App for proper z-index overlay
  const [autocompleteData, setAutocompleteData] = createSignal<{
    commands: { name: string; description: string }[];
    selectedIndex: number;
  } | null>(null);
  
  // Start/welcome overlay state
  const [showStartOverlay, setShowStartOverlay] = createSignal(false);
  
  // Todo overlay state - shown via /todo command
  const [showTodoOverlay, setShowTodoOverlay] = createSignal(false);
  
  // Compacting state - shown in ChatView when context is being compacted
  const [compactingState, setCompactingState] = createSignal<CompactingState | null>(null);
  
  // Pending continuation prompt - used to auto-continue after auto-compact
  const [pendingContinuation, setPendingContinuation] = createSignal<{
    prompt: string;
    isManual: boolean;
  } | null>(null);
  
  // Update notification - checked on startup
  const [updateState, setUpdateState] = createSignal<UpdateState | null>(null);
  
  // Copied indicator - briefly shows "Copied" in input area
  const [copiedIndicator, setCopiedIndicator] = createSignal(false);
  let copiedIndicatorTimeout: ReturnType<typeof setTimeout> | null = null;
  
  // Check if user has seen welcome screen on mount
  // NOTE: Update check is now triggered AFTER Bus subscription is set up (see below)
  onMount(async () => {
    try {
      const cfg = await loadConfig();
      if (!cfg.hasSeenWelcome) {
        setShowStartOverlay(true);
      }
    } catch {
      // Config load failed, show welcome anyway for new users
      setShowStartOverlay(true);
    }
  });
  
  // Handle start overlay close - save that user has seen it
  const handleStartOverlayClose = async () => {
    setShowStartOverlay(false);
    try {
      const cfg = await loadConfig();
      cfg.hasSeenWelcome = true;
      await saveConfig(cfg);
    } catch {
      // Ignore save errors
    }
  };
  
  // Handle message copy - copies to clipboard and shows indicator
  const handleCopyMessage = async (content: string) => {
    if (!content.trim()) return;
    
    // Copy to system clipboard
    await copyToClipboard(content);
    
    // Add to clipboard history (for /clipboard command)
    addToClipboardHistory(content);
    
    // Show indicator briefly
    if (copiedIndicatorTimeout) {
      clearTimeout(copiedIndicatorTimeout);
    }
    setCopiedIndicator(true);
    copiedIndicatorTimeout = setTimeout(() => {
      setCopiedIndicator(false);
    }, 2000);
  };
  
  // Computed: any overlay is active (unfocus input when true)
  const isOverlayActive = () => 
    !!commandOverlay() || 
    showModelSelect() || 
    showSessionPicker() || 
    !!pendingQuestions() || 
    (!!pendingPermission() && !express()) ||
    showWarning() ||
    showStartOverlay();
  
  // Subscribe to question, permission, header, and compact events from the bus
  onMount(() => {
    const unsubscribe = Bus.subscribe((event) => {
      if (event.type === "question.asked") {
        const payload = event.properties as { context?: string; questions: Question[] };
        setPendingQuestions({ 
          ...(payload.context ? { context: payload.context } : {}),
          questions: payload.questions 
        });
      }
      if (event.type === "permission.asked") {
        const payload = event.properties as PermissionRequest;
        // Ensure payload has required fields before showing permission prompt
        if (payload && payload.id && payload.patterns) {
          setPendingPermission(payload);
        }
      }
      if (event.type === "header.updated") {
        const payload = event.properties as { title: string };
        setHeaderTitle(payload.title, true); // Clear any prefix when AI sets header
      }
      // Mode changed by AI - switch mode and update current assistant message
      if (event.type === "mode.changed") {
        const payload = event.properties as { mode: string; reason?: string };
        const newMode = payload.mode as typeof MODES[number];
        if (MODES.includes(newMode)) {
          setMode(newMode);
          
          // Update the current assistant message to use the new mode
          // This changes the accent color and footer display for the rest of the turn
          const currentMessages = messages();
          const lastMsg = currentMessages[currentMessages.length - 1];
          if (lastMsg && lastMsg.role === "assistant" && lastMsg.streaming) {
            updateMessage(lastMsg.id, { mode: newMode });
          }
        }
      }
      // Session status events - show/hide compacting indicator
      if (event.type === "session.status") {
        const payload = event.properties as { sessionID: string; status: string };
        if (payload.status === "compacting") {
          setCompactingState({ status: "compacting" });
        }
      }
      // Session compacted event - update indicator and trigger continuation
      if (event.type === "session.compacted") {
        const payload = event.properties as { 
          sessionID: string; 
          summary: string; 
          removedCount: number;
          isManual?: boolean;
          continuationPrompt?: string;
        };
        // Show completion state briefly
        setCompactingState({ status: "complete", removedCount: payload.removedCount });
        
        // Store continuation prompt for processing
        if (payload.continuationPrompt) {
          setPendingContinuation({
            prompt: payload.continuationPrompt,
            isManual: payload.isManual ?? false,
          });
        }
        
        // Clear compacting state after a delay
        setTimeout(() => {
          setCompactingState(null);
        }, 2000);
      }
      // Update events - show notification in ChatView
      if (event.type === "update.installing") {
        const payload = event.properties as { latestVersion: string };
        setUpdateState({ status: "installing", latestVersion: payload.latestVersion });
      }
      if (event.type === "update.installed") {
        const payload = event.properties as { latestVersion: string };
        setUpdateState({ status: "installed", latestVersion: payload.latestVersion });
      }
      if (event.type === "update.failed") {
        const payload = event.properties as { latestVersion: string; updateCommand: string; error?: string };
        setUpdateState({ 
          status: "failed", 
          latestVersion: payload.latestVersion, 
          updateCommand: payload.updateCommand,
          ...(payload.error ? { error: payload.error } : {}),
        });
      }
    });
    
    // NOW run update check - after subscription is set up
    // This ensures we catch all update events
    setUpdateState({ status: "checking" });
    runUpdateCheck().finally(() => {
      // If no update event was received, clear the checking state
      // (happens when already on latest version or check failed silently)
      setTimeout(() => {
        setUpdateState(current => 
          current?.status === "checking" ? null : current
        );
      }, 500);
    });
    
    onCleanup(() => {
      unsubscribe();
    });
  });
  
  // Handle pending continuation after compact (auto-continue for auto-compact)
  createEffect(() => {
    const continuation = pendingContinuation();
    if (continuation && !isLoading()) {
      // Clear the pending continuation first
      setPendingContinuation(null);
      
      if (continuation.isManual) {
        // For manual compact: add AI message asking "what next?"
        addMessage({ 
          role: "assistant", 
          content: continuation.prompt 
        });
      } else {
        // For auto-compact: automatically submit continuation prompt
        // Small delay to let UI update
        setTimeout(() => {
          handleSubmit(continuation.prompt);
        }, 500);
      }
    }
  });
  
  // Handle question submission
  const handleQuestionSubmit = (answers: string[][]) => {
    setPendingQuestions(null);
    resolveQuestion(answers);
  };
  
  // Handle question cancel
  const handleQuestionCancel = () => {
    setPendingQuestions(null);
    rejectQuestion();
  };
  
  // Handle permission response
  const handlePermissionRespond = (response: PermissionResponse, message?: string) => {
    const request = pendingPermission();
    if (request) {
      setPendingPermission(null);
      if (message) {
        respondPermission({
          permissionID: request.id,
          response,
          message,
        });
      } else {
        respondPermission({
          permissionID: request.id,
          response,
        });
      }
    }
  };

  let ctrlCCount = 0;
  let escCount = 0;

  // Handle keyboard shortcuts
  useKeyboard((key) => {
    // Double Ctrl+C to exit (with warning for unsaved changes)
    if (key.ctrl && key.name === "c") {
      ctrlCCount++;
      
      if (ctrlCCount === 1 && isDirty()) {
        // First Ctrl+C with unsaved changes - show warning
        setCtrlCWarning(true);
        setTimeout(() => {
          ctrlCCount = 0;
          setCtrlCWarning(false);
        }, 2000); // 2s timeout
        return;
      }
      
      if (ctrlCCount >= 2) {
        // Second Ctrl+C - exit without saving
        renderer.destroy();
      }
      
      setTimeout(() => {
        ctrlCCount = 0;
        setCtrlCWarning(false);
      }, 500);
      return;
    }

    // Double Esc to cancel current operation
    if (key.name === "escape") {
      // First check if autocomplete is open - single Esc closes it
      if (autocompleteData()) {
        setAutocompleteData(null);
        return;
      }
      
      const processor = streamProc();
      
      // If not loading or no processor, ignore ESC
      if (!isLoading() || !processor) {
        setEscWarning(false);
        escCount = 0;
        return;
      }
      
      escCount++;
      
      if (escCount === 1) {
        // First ESC - show warning
        setEscWarning(true);
        setTimeout(() => {
          escCount = 0;
          setEscWarning(false);
        }, 1500); // 1.5s timeout to press ESC again
        return;
      }
      
      if (escCount >= 2) {
        // Second ESC - abort the stream
        processor.abort();
        setIsLoading(false);
        setStreamProc(null);
        setEscWarning(false);
        escCount = 0;
        
        // Add interruption notice to the current assistant message
        const msgs = messages();
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg && lastMsg.role === "assistant") {
          // Append interruption notice to the message
          const interruptedContent = lastMsg.content 
            ? lastMsg.content + "\n\n---\n*[Response interrupted by user]*"
            : "*[Response interrupted by user]*";
          updateMessage(lastMsg.id, { 
            content: interruptedContent,
            streaming: false 
          });
        }
      }
      return;
    }

    // Tab to cycle modes (only when no overlay is active)
    if (key.name === "tab" && !key.shift && !key.ctrl && !isOverlayActive()) {
      cycleMode();
      return;
    }

    // Shift+Tab to cycle modes reverse (only when no overlay is active)
    if (key.name === "tab" && key.shift && !isOverlayActive()) {
      cycleModeReverse();
      return;
    }
  });

  // Execute tools and continue conversation with tool results
  // NOTE: assistantContent is the content from THIS continuation only (for API messages)
  //       totalContentForUI is the accumulated total for display (passed via UI update)
  const executeToolsAndContinue = async (
    assistantMsgId: string,
    toolCallsMap: Map<number, ToolCallInfo>,
    previousApiMessages: APIMessage[],
    assistantContent: string,        // Content from THIS turn only (for API messages)
    assistantReasoning: string = "", // Reasoning from THIS turn only (for API messages)
    totalContentForUI: string = ""   // Total accumulated for UI display
  ) => {
    const toolCalls = Array.from(toolCallsMap.values());
    
    // Execute each tool and update UI
    for (const toolCall of toolCalls) {
      // Update status to running
      toolCall.status = "running";
      updateMessage(assistantMsgId, {
        toolCalls: [...toolCalls],
      });
      
      try {
        // Parse arguments
        let args: unknown;
        try {
          const parsed = JSON.parse(toolCall.arguments);
          // Strip null/undefined values - Zod .optional() doesn't accept null
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            args = Object.fromEntries(
              Object.entries(parsed).filter(([_, v]) => v !== null && v !== undefined)
            );
          } else {
            args = parsed;
          }
        } catch {
          args = {};
        }
        
        // Execute the tool
        const result = await Tool.execute(toolCall.name, args);
        
        // Debug log tool execution
        if (isDebugEnabled()) {
          await logToolExecution(toolCall.name, args, result);
        }
        
        // Update with result
        toolCall.status = result.success ? "success" : "error";
        toolCall.result = result.output;
        updateMessage(assistantMsgId, {
          toolCalls: [...toolCalls],
        });
        
        // Record tool call for stats
        recordToolCall(toolCall.name, result.success);
      } catch (error) {
        // Debug log error
        if (isDebugEnabled()) {
          await logError(`Tool execution: ${toolCall.name}`, error instanceof Error ? error : String(error));
        }
        
        toolCall.status = "error";
        toolCall.result = error instanceof Error ? error.message : "Unknown error";
        updateMessage(assistantMsgId, {
          toolCalls: [...toolCalls],
        });
        
        // Record failed tool call
        recordToolCall(toolCall.name, false);
      }
    }
    
    // Build messages for next API call per Z.AI format:
    // 1. Assistant message with tool_calls (and reasoning_content for preserved thinking)
    // 2. One "tool" message per tool call with tool_call_id
    // Z.AI docs: "thinking blocks should be explicitly preserved and returned together with the tool results"
    const assistantToolCallMessage: {
      role: "assistant";
      content: string | null;
      reasoning_content?: string;
      tool_calls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
    } = {
      role: "assistant" as const,
      content: assistantContent || null,
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.name,
          arguments: tc.arguments,
        },
      })),
    };
    
    // Include reasoning_content for preserved thinking (interleaved thinking with tools)
    if (assistantReasoning) {
      assistantToolCallMessage.reasoning_content = assistantReasoning;
    }
    
    // Build individual tool result messages (Z.AI format: role="tool" with tool_call_id)
    const toolResultMessages = toolCalls.map(tc => ({
      role: "tool" as const,
      content: tc.result || "",
      tool_call_id: tc.id,
    }));
    
    // Continue conversation with tool results
    const continuationMessages = [
      ...previousApiMessages,
      assistantToolCallMessage,
      ...toolResultMessages,
    ];
    
    // SINGLE MESSAGE BLOCK PER TURN: Reuse the same message ID
    // Keep completed tool calls visible as collapsed summaries (OpenCode style)
    // They stay in the UI to show what actions were taken
    updateMessage(assistantMsgId, {
      // toolCalls kept as-is (already updated with success/error status)
      streaming: true, // Show "Thinking..." indicator for continuation
    });
    
    // Use the same message ID for continuation
    const newAssistantMsgId = assistantMsgId;
    
    // Track the content we already have (to append to)
    // baseContent is the TOTAL accumulated content for UI display (not just this turn)
    // On first call, totalContentForUI === assistantContent (both are the initial content)
    // On recursive calls, totalContentForUI is the full accumulated content
    const baseContent = totalContentForUI || assistantContent;
    // Base reasoning from before tool execution
    const baseReasoning = assistantReasoning;
    
    try {
      // Create new stream processor and store in signal
      const newProcessor = new StreamProcessor();
      setStreamProc(newProcessor);
      
      // Accumulated content FOR THIS CONTINUATION (will be appended to base)
      let accumulatedContent = "";
      let accumulatedReasoning = "";
      const newToolCallsMap = new Map<number, ToolCallInfo>();
      
      newProcessor.onEvent((event: StreamEvent) => {
        if (event.type === "content") {
          accumulatedContent += event.delta;
          // Append new content to base content (single message block)
          // Use joinContentSections to normalize whitespace and prevent excessive blank lines
          const fullContent = joinContentSections(baseContent, accumulatedContent);
          updateMessage(newAssistantMsgId, {
            content: fullContent,
          });
        } else if (event.type === "reasoning") {
          accumulatedReasoning += event.delta;
          // Append reasoning (though typically reasoning is separate per turn)
          const fullReasoning = baseReasoning
            ? baseReasoning + "\n" + accumulatedReasoning
            : accumulatedReasoning;
          updateMessage(newAssistantMsgId, {
            reasoning: fullReasoning,
          });
        } else if (event.type === "tool_call_start") {
          const toolCallInfo: ToolCallInfo = {
            id: event.id,
            name: event.name,
            arguments: event.arguments,  // Include initial arguments from first chunk
            status: "pending",
          };
          newToolCallsMap.set(event.index, toolCallInfo);
          updateMessage(newAssistantMsgId, {
            toolCalls: Array.from(newToolCallsMap.values()),
          });
        } else if (event.type === "tool_call_delta") {
          const existing = newToolCallsMap.get(event.index);
          if (existing) {
            existing.arguments += event.arguments;
            updateMessage(newAssistantMsgId, {
              toolCalls: Array.from(newToolCallsMap.values()),
            });
          }
        } else if (event.type === "done") {
          // Record token usage if available
          if (event.state.usage) {
            addTokenUsage({
              input: event.state.usage.promptTokens,
              output: event.state.usage.completionTokens,
              // Z.AI specific: cached tokens from preserved thinking
              cacheRead: event.state.usage.cachedTokens,
              thinking: accumulatedReasoning.length > 0 ? Math.floor(accumulatedReasoning.length / 4) : 0,
            });
          }
          
          // Mark message as no longer streaming
          updateMessage(newAssistantMsgId, { streaming: false });
          
          if (event.state.finishReason === "tool_calls" && newToolCallsMap.size > 0) {
            // Recursive tool execution
            // fullContent = total accumulated for UI display (base + this continuation)
            // accumulatedContent = just this continuation's content (for API messages)
            // Use joinContentSections to normalize whitespace and prevent excessive blank lines
            const fullContent = joinContentSections(baseContent, accumulatedContent);
            
            // Pass content from THIS continuation only (accumulatedContent) for API messages
            // Pass fullContent for UI display (total accumulated across all continuations)
            executeToolsAndContinue(
              newAssistantMsgId,
              newToolCallsMap,
              continuationMessages as any,
              accumulatedContent,     // Content from THIS continuation only
              accumulatedReasoning,   // Reasoning from THIS continuation only
              fullContent             // Total for UI display
            );
          } else {
            setIsLoading(false);
            setStreamProc(null);
            // Save after AI response completes (event-driven, not interval-based)
            saveAfterResponse();
          }
        }
      });
      
      // Continue streaming with thinking config (preserved thinking)
      // Use mode-aware tool filtering
      const currentMode = mode() as typeof MODES[number];
      
      // Ensure mode is set for tool handlers (may have changed between calls)
      setCurrentMode(currentMode);
      
      const stream = GLMClient.stream({
        messages: continuationMessages as any,
        model: model() as any,
        tools: Tool.getAPIDefinitionsForMode(currentMode),
        signal: newProcessor.getAbortSignal(),
        thinking: {
          type: thinking() ? "enabled" : "disabled",
          clear_thinking: false,  // Preserve reasoning across turns
        },
      });
      
      await newProcessor.process(stream);
    } catch (error) {
      updateMessage(newAssistantMsgId, {
        content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
      setIsLoading(false);
      setStreamProc(null);
    }
  };

  // Handle message submission
  const handleSubmit = async (content: string) => {
    if (isLoading()) return;

    const trimmedContent = content.trim();
    if (!trimmedContent) return;

    // Check if this is a command (starts with /)
    if (trimmedContent.startsWith("/")) {
      const parsed = CommandRegistry.parse(trimmedContent);
      
      // Handle /exit and /quit specially - print summary to terminal after exit
      if (parsed && (parsed.name === "exit" || parsed.name === "quit")) {
        // Save session before exit
        await saveOnExit();
        
        // Generate summary from UI context (source of truth)
        const currentStats = stats();
        const currentModel = model();
        const currentHeaderTitle = headerTitle();
        
        // Calculate approximate duration from first message
        const firstMsg = messages()[0];
        const duration = firstMsg 
          ? formatDuration(Date.now() - firstMsg.timestamp)
          : "0m";
        
        // Format tool breakdown (top 4 tools by usage)
        const toolBreakdown = Object.entries(currentStats.tools.byName)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([name, count]) => `${name}: ${count}`)
          .join("  ");
        
        // Format token stats
        const tokens = currentStats.tokens;
        const totalTokens = tokens.input + tokens.output + tokens.thinking;
        
        // Get session ID for continuation hint
        const currentSessionId = currentStats.sessionId;
        
        // Column alignment helpers
        const COL1 = 14; // Label column width
        const COL2 = 15; // First value column width
        const COL3 = 17; // Second value column width
        const pad = (s: string, w: number) => s.padEnd(w);
        
        const summaryLines = [
          "━".repeat(66),
          "IMPULSE SESSION COMPLETE",
          "━".repeat(66),
          `  ${pad("Session", COL1)}${currentHeaderTitle}`,
          `  ${pad("Model", COL1)}${currentModel}`,
          `  ${pad("Duration", COL1)}${duration}`,
          "───────────────────────────────────────────────────────────────────",
          `  ${pad("Tools", COL1)}${pad(currentStats.tools.total + " calls", COL2)}${pad(currentStats.tools.success + " success", COL3)}${currentStats.tools.failed} failed`,
        ];
        
        // Add tool breakdown if there are any tool calls
        if (toolBreakdown) {
          summaryLines.push(`  ${pad("", COL1)}${toolBreakdown}`);
        }
        
        summaryLines.push(
          `  ${pad("Tokens", COL1)}${pad(totalTokens.toLocaleString() + " total", COL2)}`,
          `  ${pad("", COL1)}${pad("In: " + tokens.input.toLocaleString(), COL2)}${pad("Out: " + tokens.output.toLocaleString(), COL3)}Think: ${tokens.thinking.toLocaleString()}`,
          `  ${pad("", COL1)}${pad("Cache read: " + tokens.cacheRead.toLocaleString(), COL2 + COL3)}Cache write: ${tokens.cacheWrite.toLocaleString()}`,
        );
        
        // Add continuation hint if session was saved
        if (currentSessionId) {
          summaryLines.push(
            "───────────────────────────────────────────────────────────────────",
            `  ${pad("Continue", COL1)}impulse -s ${currentSessionId}   or   impulse -c`,
          );
        }
        
        summaryLines.push("━".repeat(66));
        
        const summary = summaryLines.join("\n");
        
        // Destroy renderer first
        renderer.destroy();
        
        // Print summary to stdout after app closes (like Gemini CLI)
        process.stdout.write("\n" + summary + "\n");
        
        // Exit cleanly
        process.exit(0);
      }
      
      // Handle /new and /clear specially - reset session without popup
      if (parsed && (parsed.name === "new" || parsed.name === "clear")) {
        // Create new session (clears messages in SessionContext)
        await createNewSession();
        // Reset header
        setHeaderTitle("New session");
        setHeaderPrefix(null);
        // No popup - just silently reset
        return;
      }
      
      // Handle /start specially - show welcome overlay
      if (parsed && parsed.name === "start") {
        setAutocompleteData(null);
        setShowStartOverlay(true);
        return;
      }
      
      // Handle /todo specially - show todo list overlay
      if (parsed && parsed.name === "todo") {
        setAutocompleteData(null);
        setShowTodoOverlay(true);
        return;
      }
      
      // Handle /model specially - show interactive selection popup
      // Only if no model name provided (just "/model")
      if (parsed && parsed.name === "model") {
        const hasModelArg = trimmedContent.trim().split(/\s+/).length > 1;
        if (!hasModelArg) {
          setAutocompleteData(null);  // Clear command autocomplete before showing picker
          setShowModelSelect(true);
          return;
        }
      }
      
      // Handle /load specially - show interactive session picker
      // Only if no session ID provided (just "/load")
      if (parsed && parsed.name === "load") {
        const hasSessionArg = trimmedContent.trim().split(/\s+/).length > 1;
        if (!hasSessionArg) {
          setAutocompleteData(null);  // Clear command autocomplete before showing picker
          setShowSessionPicker(true);
          return;
        }
      }
      
      // Handle /express specially - toggle Express mode using context
      // Only show warning on first enable, no confirmation on disable or subsequent enables
      if (parsed && parsed.name === "express") {
        toggleExpress();
        // No confirmation overlay - warning shown on first enable via ExpressWarning component
        // Status line [EX] indicator shows current state
        return;
      }
      
      // Handle /verbose specially - toggle verbose tool display in session context
      if (parsed && parsed.name === "verbose") {
        setVerboseTools((current) => !current);
        // No confirmation overlay - just toggle silently
        return;
      }
      
      // Handle /think specially - toggle thinking mode without confirmation
      if (parsed && parsed.name === "think") {
        setThinking((current) => !current);
        // No confirmation overlay - just toggle silently
        return;
      }
      
      // Handle /compact - set "Compacted:" prefix on header (no confirmation overlay)
      if (parsed && parsed.name === "compact") {
        await CommandRegistry.execute(trimmedContent);
        setHeaderPrefix("Compacted");
        // No overlay - compacting indicator in ChatView shows progress
        // The AI will respond with "what next?" prompt after compaction
        return;
      }
      
      // Handle /undo - set "Reverted:" prefix on header
      if (parsed && parsed.name === "undo") {
        const result = await CommandRegistry.execute(trimmedContent);
        setHeaderPrefix("Reverted");
        setCommandOverlay({
          title: "/undo",
          content: result.success 
            ? result.output || "Changes reverted"
            : result.error || "Undo failed",
          isError: !result.success,
        });
        return;
      }
      
      // Handle /redo - set "Reapplied:" prefix on header
      if (parsed && parsed.name === "redo") {
        const result = await CommandRegistry.execute(trimmedContent);
        setHeaderPrefix("Reapplied");
        setCommandOverlay({
          title: "/redo",
          content: result.success 
            ? result.output || "Changes reapplied"
            : result.error || "Redo failed",
          isError: !result.success,
        });
        return;
      }

      // Execute other commands - show result in overlay (not as a message)
      const result = await CommandRegistry.execute(trimmedContent);
      
      // Get command name for overlay title
      const cmdName = parsed?.name || trimmedContent.slice(1).split(/\s/)[0] || "Command";
      
      // Clear autocomplete before showing result overlay
      setAutocompleteData(null);
      
      // Show result in overlay - doesn't add to messages, doesn't transition screens
      setCommandOverlay({
        title: `/${cmdName}`,
        content: result.success 
          ? result.output || "Command executed successfully"
          : result.error || "Unknown error",
        isError: !result.success,
      });
      return;
    }

    // Regular message - send to API
    // Ensure session is created on first message (lazy creation)
    await ensureSessionCreated();
    
    // Mark that user has started a session (keeps session view after /clear)
    setHasStartedSession(true);
    
    // Debug log user message
    if (isDebugEnabled()) {
      await logUserMessage(trimmedContent);
    }
    
    // Add user message
    addMessage({ role: "user", content: trimmedContent });

    setIsLoading(true);

    // Capture current mode for this assistant message
    const currentMode = mode() as typeof MODES[number];

    // Add assistant message placeholder with streaming flag and current mode
    addMessage({ role: "assistant", content: "", streaming: true, mode: currentMode, model: model() });

    // Get the assistant message ID (last message)
    const updatedMessages = messages();
    const assistantMsg = updatedMessages[updatedMessages.length - 1];

    if (!assistantMsg) {
      setIsLoading(false);
      return;
    }

    const assistantMsgId = assistantMsg.id;

    try {
      // Build messages for API call (without the empty assistant message)
      // Generate mode-aware system prompt with MCP discovery instructions
      
      // Set the mode for tool handlers (for mode-aware path restrictions)
      setCurrentMode(currentMode);
      
      const systemMessage: APIMessage = {
        role: "system",
        content: generateSystemPrompt(currentMode),
      };
      
      // Build messages for API with proper tool call serialization
      // This handles: tool_calls arrays, tool result messages, and preserved thinking
      const conversationMessages = buildAPIMessages(updatedMessages, assistantMsgId);
      const apiMessages = [systemMessage, ...conversationMessages];

      // Debug log API request (use mode-filtered tools for accurate logging)
      if (isDebugEnabled()) {
        await logAPIRequest(model(), apiMessages, Tool.getAPIDefinitionsForMode(currentMode));
        await logRawAPIMessages(apiMessages);
      }

      // Create stream processor and store in signal
      const processor = new StreamProcessor();
      setStreamProc(processor);

      let accumulatedContent = "";
      let accumulatedReasoning = "";
      const toolCallsMap = new Map<number, ToolCallInfo>();

      // Handle stream events - batch updates at 16ms (~60fps) for smooth rendering
      processor.onEvent((event: StreamEvent) => {
        if (event.type === "content") {
          accumulatedContent += event.delta;
          // Batch content updates for 60fps rendering
          batchUpdate("stream-content", () => {
            updateMessage(assistantMsgId, {
              content: accumulatedContent,
            });
          }, Timing.batchInterval);
        } else if (event.type === "reasoning") {
          accumulatedReasoning += event.delta;
          // Batch reasoning updates
          batchUpdate("stream-reasoning", () => {
            updateMessage(assistantMsgId, {
              reasoning: accumulatedReasoning,
            });
          }, Timing.batchInterval);
        } else if (event.type === "tool_call_start") {
          // New tool call starting - update immediately for responsiveness
          const toolCall: ToolCallInfo = {
            id: event.id,
            name: event.name,
            arguments: event.arguments,  // Include initial arguments from first chunk
            status: "pending",
          };
          toolCallsMap.set(event.index, toolCall);
          updateMessage(assistantMsgId, {
            toolCalls: Array.from(toolCallsMap.values()),
          });
        } else if (event.type === "tool_call_delta") {
          // Tool call arguments streaming in - batch these updates
          const existing = toolCallsMap.get(event.index);
          if (existing) {
            existing.arguments += event.arguments;
            batchUpdate("stream-tools", () => {
              updateMessage(assistantMsgId, {
                toolCalls: Array.from(toolCallsMap.values()),
              });
            }, Timing.batchInterval);
          }
        } else if (event.type === "done") {
          // Flush any pending batched updates before finishing
          flushBatch("stream-content");
          flushBatch("stream-reasoning");
          flushBatch("stream-tools");
          
          // Record token usage if available
          if (event.state.usage) {
            addTokenUsage({
              input: event.state.usage.promptTokens,
              output: event.state.usage.completionTokens,
              // Z.AI specific: cached tokens from preserved thinking
              cacheRead: event.state.usage.cachedTokens,
              // Z.AI doesn't split out thinking tokens in usage, but reasoning is separate
              thinking: accumulatedReasoning.length > 0 ? Math.floor(accumulatedReasoning.length / 4) : 0, // Rough estimate
            });
          }
          
          // Stream finished - mark message as no longer streaming
          updateMessage(assistantMsgId, { streaming: false });
          
          // Check if we need to execute tools
          if (event.state.finishReason === "tool_calls" && toolCallsMap.size > 0) {
            // Execute tools and continue conversation
            // First call: content for this turn = accumulated content, total for UI = same
            executeToolsAndContinue(assistantMsgId, toolCallsMap, apiMessages, accumulatedContent, accumulatedReasoning, accumulatedContent);
          } else {
            setIsLoading(false);
            setStreamProc(null);
            // Save after AI response completes (event-driven, not interval-based)
            saveAfterResponse();
          }
        }
      });

      // Start streaming with thinking config
      // Z.AI docs: thinking.type controls reasoning, clear_thinking: false enables preserved thinking
      // Use mode-aware tool filtering (currentMode already defined above)
      const stream = GLMClient.stream({
        messages: apiMessages,
        model: model() as any,
        tools: Tool.getAPIDefinitionsForMode(currentMode),
        signal: processor.getAbortSignal(),
        thinking: {
          type: thinking() ? "enabled" : "disabled",
          clear_thinking: false,  // Preserve reasoning across turns
        },
      });

      await processor.process(stream);
    } catch (error) {
      // Update assistant message with error
      updateMessage(assistantMsgId, {
        content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
      setIsLoading(false);
      setStreamProc(null);
    }
  };

  // Use Show for reactive conditional rendering
  // Show session view if we have messages OR if user has started a session (for /clear behavior)
  return (
    <>
      <Show
        when={messages().length > 0 || hasStartedSession()}
        fallback={<WelcomeScreen onSubmit={handleSubmit} onAutocompleteChange={setAutocompleteData} updateState={updateState()} onDismissUpdate={() => setUpdateState(null)} />}
      >
        {/* Session view with unified gutter layout */}
        <box 
          flexDirection="column" 
          width="100%" 
          height="100%"
          paddingTop={1}
        >
          {/* Header line at top - full width (2 rows: title + spacing) */}
          <box flexShrink={0} height={2} paddingLeft={GUTTER_WIDTH + 4} paddingRight={4}>
            <HeaderLine title={headerTitle()} prefix={headerPrefix()} />
          </box>
          
          {/* Main content row: Gutter + Content column */}
          {/* flexGrow={1} + flexShrink={1} allows this to fill remaining space */}
          <box flexDirection="row" flexGrow={1} flexShrink={1} minWidth={0} minHeight={0} overflow="hidden">
            {/* Left gutter - fills height of this row (static, no animation) */}
            <box paddingLeft={1} flexShrink={0}>
              <Gutter />
            </box>
            
            {/* Content column */}
            <box flexDirection="column" flexGrow={1} minWidth={0} paddingRight={4}>
              {/* Chat area - flexGrow={1} takes remaining space */}
              <ChatView 
                messages={messages()} 
                isLoading={isLoading()}
                compactingState={compactingState()} 
                updateState={updateState()} 
                onDismissUpdate={() => setUpdateState(null)}
                onCopyMessage={handleCopyMessage}
              />
              
              {/* Bottom section - flexShrink={0} prevents compression by chat content */}
              <box flexDirection="column" flexShrink={0}>
                {/* Warning lines (ESC and Ctrl+C) */}
                <box height={1} justifyContent="center">
                  <Show when={escWarning()}>
                    <text fg={Colors.status.warning}>Hit ESC again to stop generation</text>
                  </Show>
                  <Show when={ctrlCWarning() && !escWarning()}>
                    <text fg={Colors.status.warning}>Exit without saving? Ctrl+C again to confirm</text>
                  </Show>
                </box>
                
                {/* Bottom panel: 70% prompt + 30% todos (fixed height) */}
                <BottomPanel
                  mode={mode()}
                  model={model()}
                  thinking={thinking()}
                  loading={isLoading()}
                  overlayActive={isOverlayActive()}
                  copiedIndicator={copiedIndicator()}
                  onSubmit={handleSubmit}
                  onAutocompleteChange={setAutocompleteData}
                />
              </box>
            </box>
          </box>
          
          {/* Status line at very bottom - full width, outside gutter area */}
          <box flexShrink={0} height={1} paddingLeft={GUTTER_WIDTH + 4} paddingRight={4}>
            <StatusLine loading={isLoading()} />
          </box>
        </box>
      </Show>
      
      {/* Command result overlay - shown on top of both welcome and session */}
      <Show when={commandOverlay()}>
        {(overlay: () => { title: string; content: string; isError: boolean }) => (
          <CommandResultOverlay
            title={overlay().title}
            content={overlay().content}
            isError={overlay().isError}
            onClose={() => setCommandOverlay(null)}
          />
        )}
      </Show>
      
      {/* Model select overlay */}
      <Show when={showModelSelect()}>
        <ModelSelectOverlay
          currentModel={model()}
          onSelect={(newModel) => {
            // Update the session model and close overlay immediately
            setModel(newModel);
            setShowModelSelect(false);
            // No confirmation dialog - just select and close
          }}
          onCancel={() => setShowModelSelect(false)}
        />
      </Show>
      
      {/* Session picker overlay */}
      <Show when={showSessionPicker()}>
        <SessionPickerOverlay
          onSelect={(session) => {
            // Close picker and mark session started FIRST (sync)
            setShowSessionPicker(false);
            setHasStartedSession(true);
            // Then load session data (async, but UI already transitioned)
            loadSession(session.id);
          }}
          onCancel={() => setShowSessionPicker(false)}
        />
      </Show>
      
      {/* Question overlay - shown when AI calls the question tool */}
      <Show when={pendingQuestions()}>
        {(data: () => { context?: string; questions: Question[] }) => (
          <QuestionOverlay
            {...(data().context ? { context: data().context } : {})}
            questions={data().questions}
            onSubmit={handleQuestionSubmit}
            onCancel={handleQuestionCancel}
          />
        )}
      </Show>
      
      {/* Permission prompt - shown when a tool needs user approval */}
      <Show when={pendingPermission() && !express()}>
        {(request: () => PermissionRequest) => (
          <box
            position="absolute"
            width="100%"
            height="100%"
            justifyContent="center"
            alignItems="center"
          >
            <PermissionPrompt
              request={request()}
              onRespond={handlePermissionRespond}
            />
          </box>
        )}
      </Show>
      
      {/* Express mode warning - shown first time Express is enabled */}
      <Show when={showWarning()}>
        <ExpressWarning onAcknowledge={acknowledgeExpress} />
      </Show>
      
      {/* Start/welcome overlay - shown on first launch or via /start */}
      <Show when={showStartOverlay()}>
        <StartOverlay onClose={handleStartOverlayClose} />
      </Show>
      
      {/* Todo overlay - shown via /todo command */}
      <Show when={showTodoOverlay()}>
        <TodoOverlay onClose={() => setShowTodoOverlay(false)} />
      </Show>
      
      {/* Command autocomplete overlay - positioned above input area */}
      {/* On WelcomeScreen: centered. On session view: left-aligned with gutter offset */}
      <Show when={autocompleteData()}>
        {(data: () => { commands: CommandCandidate[]; selectedIndex: number }) => {
          const isOnWelcomeScreen = () => messages().length === 0 && !hasStartedSession();
          const menuWidth = 70;
          // WelcomeScreen: center the menu. Session view: offset from gutter
          const leftPos = () => isOnWelcomeScreen() 
            ? Math.max(4, Math.floor((dimensions().width - menuWidth) / 2))
            : GUTTER_WIDTH + 4;
          // WelcomeScreen: position above the centered input. Session view: above bottom panel
          const bottomPos = () => isOnWelcomeScreen() ? 4 : 12;
          
          return (
            <box
              position="absolute"
              bottom={bottomPos()}
              left={leftPos()}
              width={menuWidth}
              border
              borderColor={Colors.ui.dim}
              flexDirection="column"
              backgroundColor="#1a1a1a"
            >
              {/* Windowed view of commands - show 10 items max, centered on selection */}
              {(() => {
                const maxVisible = 10;
                const commands = data().commands;
                const selectedIdx = data().selectedIndex;
                const total = commands.length;
                
                // Calculate window start to keep selection visible and roughly centered
                let start = 0;
                if (total > maxVisible) {
                  // Try to center the selection
                  start = Math.max(0, selectedIdx - Math.floor(maxVisible / 2));
                  // Don't go past the end
                  start = Math.min(start, total - maxVisible);
                }
                const end = Math.min(start + maxVisible, total);
                const visibleCommands = commands.slice(start, end);
                const showScrollUp = start > 0;
                const showScrollDown = end < total;
                
                return (
                  <box flexDirection="column">
                    <Show when={showScrollUp}>
                      <text fg={Colors.ui.dim} paddingLeft={1}>  ↑ {start} more...</text>
                    </Show>
                    <For each={visibleCommands}>
                      {(cmd, localIndex) => {
                        const globalIndex = start + localIndex();
                        const isSelected = globalIndex === selectedIdx;
                        return (
                          <Show
                            when={isSelected}
                            fallback={
                              <box flexDirection="row" height={1}>
                                <text fg={Colors.ui.text}>
                                  {` /${cmd.name.padEnd(12)}`}
                                </text>
                                <text fg={Colors.ui.dim} wrapMode="none">
                                  {cmd.description}
                                </text>
                              </box>
                            }
                          >
                            <box flexDirection="row" height={1} backgroundColor={Colors.mode.AGENT}>
                              <text fg="#000000">
                                {` /${cmd.name.padEnd(12)}`}
                              </text>
                              <text fg="#000000" wrapMode="none">
                                {cmd.description}
                              </text>
                            </box>
                          </Show>
                        );
                      }}
                    </For>
                    <Show when={showScrollDown}>
                      <text fg={Colors.ui.dim} paddingLeft={1}>  ↓ {total - end} more...</text>
                    </Show>
                  </box>
                );
              })()}
              <box height={1} paddingLeft={1}>
                <text fg={Colors.ui.dim}>Tab: complete | Enter: select | Esc: close</text>
              </box>
            </box>
          );
        }}
      </Show>
    </>
  );
}
