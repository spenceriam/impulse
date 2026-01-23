import { createSignal, createEffect, Show, onMount, onCleanup, For } from "solid-js";
import { useRenderer, useKeyboard, useTerminalDimensions } from "@opentui/solid";
import type { PasteEvent } from "@opentui/core";
import { StatusLine, HeaderLine, InputArea, ChatView, BottomPanel, QuestionOverlay, PermissionPrompt, ExpressWarning, SessionPickerOverlay, StartOverlay, Gutter, GUTTER_WIDTH, type CommandCandidate } from "./components";
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
import { type ToolCallInfo } from "./components/MessageBlock";
import { registerMCPTools } from "../mcp";
import packageJson from "../../package.json";

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
        title="API Key Required"
        flexDirection="column"
        padding={2}
        width={70}
        backgroundColor="#1a1a1a"
      >
        <text fg={Colors.ui.text}>
          No API key detected. Please enter your Z.AI API key.
        </text>
        <box height={1} />
        <text fg={Colors.ui.dim}>
          You can also set the GLM_API_KEY environment variable.
        </text>
        <box height={1} />
        <box flexDirection="row">
          <text fg={Colors.ui.dim}>API Key: </text>
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
}) {
  const { mode, thinking } = useMode();
  const { model } = useSession();
  const dimensions = useTerminalDimensions();
  const terminalWidth = () => dimensions().width;

  // ASCII logo for GLM-CLI - centered inside [[ ]] frame
  const logo = [
    " ██████╗ ██╗     ███╗   ███╗       ██████╗██╗     ██╗",
    "██╔════╝ ██║     ████╗ ████║      ██╔════╝██║     ██║",
    "██║  ███╗██║     ██╔████╔██║█████╗██║     ██║     ██║",
    "██║   ██║██║     ██║╚██╔╝██║╚════╝██║     ██║     ██║",
    "╚██████╔╝███████╗██║ ╚═╝ ██║      ╚██████╗███████╗██║",
    " ╚═════╝ ╚══════╝╚═╝     ╚═╝       ╚═════╝╚══════╝╚═╝",
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
        
        {/* 5-line gap between logo box and prompt */}
        <box height={5} />
        
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

// Main app wrapper
export function App(props: { initialExpress?: boolean }) {
  const renderer = useRenderer();
  
  // Register commands and MCP tools on mount
  onMount(() => {
    initializeCommands();
    // MCP tools registered async in background (don't block UI)
    initializeMCPTools();
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

  // Show API key overlay if needed, otherwise show main app
  return (
    <ModeProvider>
      <SessionProvider>
        <TodoProvider>
          <ExpressProvider initialExpress={props.initialExpress ?? false}>
            {/* Use explicit dimensions from terminal, not "100%" strings */}
            <box 
              width={dimensions().width} 
              height={dimensions().height} 
              padding={1}
            >
              <Show when={hasApiKey()}>
                <AppWithSession />
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

// App that decides between welcome screen and session view
function AppWithSession() {
  const { messages, addMessage, updateMessage, model, setModel, headerTitle, setHeaderTitle, headerPrefix, setHeaderPrefix, createNewSession, loadSession, stats, recordToolCall, addTokenUsage, ensureSessionCreated, saveAfterResponse, saveOnExit, isDirty } = useSession();
  const { mode, thinking, setThinking, cycleMode, cycleModeReverse } = useMode();
  const { express, showWarning, acknowledge: acknowledgeExpress, toggle: toggleExpress } = useExpress();
  const renderer = useRenderer();

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
  
  // Session picker overlay state
  const [showSessionPicker, setShowSessionPicker] = createSignal(false);
  
  // Question overlay state (from AI question tool)
  const [pendingQuestions, setPendingQuestions] = createSignal<Question[] | null>(null);
  
  // Permission prompt state (from tool permission requests)
  const [pendingPermission, setPendingPermission] = createSignal<PermissionRequest | null>(null);
  
  // Command autocomplete state - lifted to App for proper z-index overlay
  const [autocompleteData, setAutocompleteData] = createSignal<{
    commands: { name: string; description: string }[];
    selectedIndex: number;
  } | null>(null);
  
  // Start/welcome overlay state
  const [showStartOverlay, setShowStartOverlay] = createSignal(false);
  
  // Check if user has seen welcome screen on mount
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
  
  // Computed: any overlay is active (unfocus input when true)
  const isOverlayActive = () => 
    !!commandOverlay() || 
    showModelSelect() || 
    showSessionPicker() || 
    !!pendingQuestions() || 
    (!!pendingPermission() && !express()) ||
    showWarning() ||
    showStartOverlay();
  
  // Subscribe to question, permission, and header events from the bus
  onMount(() => {
    const unsubscribe = Bus.subscribe((event) => {
      if (event.type === "question.asked") {
        const payload = event.properties as { questions: Question[] };
        setPendingQuestions(payload.questions);
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
    });
    
    onCleanup(() => {
      unsubscribe();
    });
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
      }
      return;
    }

    // Tab to cycle modes
    if (key.name === "tab" && !key.shift && !key.ctrl) {
      cycleMode();
      return;
    }

    // Shift+Tab to cycle modes reverse
    if (key.name === "tab" && key.shift) {
      cycleModeReverse();
      return;
    }
  });

  // Execute tools and continue conversation with tool results
  const executeToolsAndContinue = async (
    assistantMsgId: string,
    toolCallsMap: Map<number, ToolCallInfo>,
    previousApiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    assistantContent: string
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
        
        // Update with result
        toolCall.status = result.success ? "success" : "error";
        toolCall.result = result.output;
        updateMessage(assistantMsgId, {
          toolCalls: [...toolCalls],
        });
        
        // Record tool call for stats
        recordToolCall(toolCall.name, result.success);
      } catch (error) {
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
    // 1. Assistant message with tool_calls
    // 2. One "tool" message per tool call with tool_call_id
    const assistantToolCallMessage = {
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
    
    // Add new assistant message for continuation
    addMessage({ role: "assistant", content: "" });
    const newMessages = messages();
    const newAssistantMsg = newMessages[newMessages.length - 1];
    if (!newAssistantMsg) {
      setIsLoading(false);
      return;
    }
    
    const newAssistantMsgId = newAssistantMsg.id;
    
    try {
      // Create new stream processor and store in signal
      const newProcessor = new StreamProcessor();
      setStreamProc(newProcessor);
      
      let accumulatedContent = "";
      let accumulatedReasoning = "";
      const newToolCallsMap = new Map<number, ToolCallInfo>();
      
      newProcessor.onEvent((event: StreamEvent) => {
        if (event.type === "content") {
          accumulatedContent += event.delta;
          updateMessage(newAssistantMsgId, {
            content: accumulatedContent,
          });
        } else if (event.type === "reasoning") {
          accumulatedReasoning += event.delta;
          updateMessage(newAssistantMsgId, {
            reasoning: accumulatedReasoning,
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
              thinking: accumulatedReasoning.length > 0 ? Math.floor(accumulatedReasoning.length / 4) : 0,
            });
          }
          
          if (event.state.finishReason === "tool_calls" && newToolCallsMap.size > 0) {
            // Recursive tool execution
            executeToolsAndContinue(
              newAssistantMsgId,
              newToolCallsMap,
              continuationMessages as any,
              accumulatedContent
            );
          } else {
            setIsLoading(false);
            setStreamProc(null);
            // Save after AI response completes (event-driven, not interval-based)
            saveAfterResponse();
          }
        }
      });
      
      const stream = GLMClient.stream({
        messages: continuationMessages as any,
        model: model() as any,
        tools: Tool.getAPIDefinitions(),
        signal: newProcessor.getAbortSignal(),
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
        
        const summaryLines = [
          "━".repeat(66),
          "  GLM-CLI SESSION COMPLETE",
          "━".repeat(66),
          "",
          `  Session       ${currentHeaderTitle}`,
          `  Model         ${currentModel}`,
          `  Duration      ${duration}`,
          "",
          "━".repeat(66),
          "  TOOLS",
          "━".repeat(66),
          "",
          `  Calls         ${currentStats.tools.total} total     ${currentStats.tools.success} success     ${currentStats.tools.failed} failed`,
        ];
        
        // Add tool breakdown if there are any tool calls
        if (toolBreakdown) {
          summaryLines.push(`  ${toolBreakdown}`);
        }
        
        summaryLines.push(
          "",
          "━".repeat(66),
          "  TOKENS",
          "━".repeat(66),
          "",
          `  Input         ${tokens.input.toLocaleString()}       Cache read     ${tokens.cacheRead.toLocaleString()}`,
          `  Output        ${tokens.output.toLocaleString()}       Cache write    ${tokens.cacheWrite.toLocaleString()}`,
          `  Thinking      ${tokens.thinking.toLocaleString()}       Total          ${totalTokens.toLocaleString()}`,
          "",
          "━".repeat(66),
          "",
          "  Until next time!",
          "",
          "━".repeat(66),
        );
        
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
      
      // Handle /think specially - toggle thinking mode without confirmation
      if (parsed && parsed.name === "think") {
        setThinking((current) => !current);
        // No confirmation overlay - just toggle silently
        return;
      }
      
      // Handle /compact - set "Compacted:" prefix on header
      if (parsed && parsed.name === "compact") {
        const result = await CommandRegistry.execute(trimmedContent);
        setHeaderPrefix("Compacted");
        setCommandOverlay({
          title: "/compact",
          content: result.success 
            ? result.output || "Session compacted"
            : result.error || "Compact failed",
          isError: !result.success,
        });
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
    
    // Add user message
    addMessage({ role: "user", content: trimmedContent });

    setIsLoading(true);

    // Add assistant message placeholder with streaming flag
    addMessage({ role: "assistant", content: "", streaming: true });

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
      const currentMode = mode() as typeof MODES[number];
      const systemMessage = {
        role: "system" as const,
        content: generateSystemPrompt(currentMode),
      };
      
      const userMessages = updatedMessages
        .filter((m) => m.id !== assistantMsgId)
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));
      
      const apiMessages = [systemMessage, ...userMessages];

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
              // Z.AI doesn't split out thinking tokens in usage, but reasoning is separate
              thinking: accumulatedReasoning.length > 0 ? Math.floor(accumulatedReasoning.length / 4) : 0, // Rough estimate
            });
          }
          
          // Stream finished - mark message as no longer streaming
          updateMessage(assistantMsgId, { streaming: false });
          
          // Check if we need to execute tools
          if (event.state.finishReason === "tool_calls" && toolCallsMap.size > 0) {
            // Execute tools and continue conversation
            executeToolsAndContinue(assistantMsgId, toolCallsMap, apiMessages, accumulatedContent);
          } else {
            setIsLoading(false);
            setStreamProc(null);
            // Save after AI response completes (event-driven, not interval-based)
            saveAfterResponse();
          }
        }
      });

      // Start streaming
      const stream = GLMClient.stream({
        messages: apiMessages,
        model: model() as any,
        tools: Tool.getAPIDefinitions(),
        signal: processor.getAbortSignal(),
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
        fallback={<WelcomeScreen onSubmit={handleSubmit} onAutocompleteChange={setAutocompleteData} />}
      >
        {/* Session view with unified gutter layout */}
        <box 
          flexDirection="column" 
          width="100%" 
          height="100%"
          paddingTop={1}
        >
          {/* Header line at top - full width */}
          <box flexShrink={0} height={1} paddingLeft={GUTTER_WIDTH + 4} paddingRight={4}>
            <HeaderLine title={headerTitle()} prefix={headerPrefix()} />
          </box>
          
          {/* Main content row: Gutter + Content column */}
          {/* flexGrow={1} + flexShrink={1} allows this to fill remaining space */}
          <box flexDirection="row" flexGrow={1} flexShrink={1} minWidth={0} minHeight={0} overflow="hidden">
            {/* Left gutter - fills height of this row */}
            <box paddingLeft={1} flexShrink={0}>
              <Gutter loading={isLoading()} />
            </box>
            
            {/* Content column */}
            <box flexDirection="column" flexGrow={1} minWidth={0} paddingRight={4}>
              {/* Chat area - flexGrow={1} takes remaining space */}
              <ChatView messages={messages()} />
              
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
                  onSubmit={handleSubmit}
                  onAutocompleteChange={setAutocompleteData}
                />
              </box>
            </box>
          </box>
          
          {/* Status line at very bottom - full width, outside gutter area */}
          <box flexShrink={0} height={1} paddingLeft={GUTTER_WIDTH + 4} paddingRight={4}>
            <StatusLine />
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
          onSelect={async (session) => {
            // Load the selected session
            setShowSessionPicker(false);
            await loadSession(session.id);
          }}
          onCancel={() => setShowSessionPicker(false)}
        />
      </Show>
      
      {/* Question overlay - shown when AI calls the question tool */}
      <Show when={pendingQuestions()}>
        {(questions: () => Question[]) => (
          <QuestionOverlay
            questions={questions()}
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
            backgroundColor="rgba(0, 0, 0, 0.7)"
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
      
      {/* Command autocomplete overlay - positioned above input area */}
      <Show when={autocompleteData()}>
        {(data: () => { commands: CommandCandidate[]; selectedIndex: number }) => (
          <box
            position="absolute"
            bottom={12}
            left={8}
            width={70}
            border
            borderColor={Colors.ui.dim}
            flexDirection="column"
            backgroundColor="#1a1a1a"
          >
            <scrollbox height={Math.min(10, data().commands.length + 1)}>
              <box flexDirection="column">
                <For each={data().commands}>
                  {(cmd, index) => {
                    const isSelected = () => index() === data().selectedIndex;
                    return (
                      <Show
                        when={isSelected()}
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
              </box>
            </scrollbox>
            <box height={1} paddingLeft={1}>
              <text fg={Colors.ui.dim}>Tab: complete | Enter: select | Esc: close</text>
            </box>
          </box>
        )}
      </Show>
    </>
  );
}
