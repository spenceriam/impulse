import { createSignal, createEffect, Show, onMount, For } from "solid-js";
import { useRenderer, useKeyboard } from "@opentui/solid";
import type { PasteEvent } from "@opentui/core";
import { StatusLine, InputArea, ChatView, Sidebar, CollapsedSidebar } from "./components";
import { ModeProvider, useMode } from "./context/mode";
import { SessionProvider, useSession } from "./context/session";
import { TodoProvider } from "./context/todo";
import { SidebarProvider, useSidebar } from "./context/sidebar";
import { load as loadConfig, save as saveConfig } from "../util/config";
import { GLMClient } from "../api/client";
import { StreamProcessor, StreamEvent } from "../api/stream";
import { Colors } from "./design";
import { CommandRegistry } from "../commands/registry";
import { registerCoreCommands } from "../commands/core";
import { registerUtilityCommands } from "../commands/utility";
import { registerInfoCommands } from "../commands/info";
import { registerInitCommand } from "../commands/init";
import { GLM_MODELS, MODES } from "../constants";
import { generateSystemPrompt } from "../agent/prompts";
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
        padding={2}
        width={70}
        maxHeight={20}
        backgroundColor="#1a1a1a"
      >
        <text fg={props.isError ? Colors.status.error : Colors.ui.text}>
          {props.content}
        </text>
        <box height={1} />
        <text fg={Colors.ui.dim}>
          Press Enter or Esc to close
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
        width={90}
        backgroundColor="#1a1a1a"
      >
        {/* Header row - no leading space, aligned with data rows */}
        <text fg={Colors.ui.dim}>
          {"MODEL".padEnd(MODEL_COL_WIDTH)}
          {"INPUT".padEnd(INPUT_COL_WIDTH)}
          {"DESCRIPTION"}
        </text>
        <box height={1} />
        {/* Model rows */}
        <For each={[...GLM_MODELS]}>
          {(model, index) => {
            const isSelected = () => index() === selectedIndex();
            const isCurrent = model === props.currentModel;
            const info = MODEL_INFO[model] || { description: "", input: "text" };
            const displayName = model.toUpperCase();
            
            // Build the row content with proper alignment (no > prefix)
            const nameCol = displayName.padEnd(MODEL_COL_WIDTH);
            const inputCol = info.input.padEnd(INPUT_COL_WIDTH);
            const desc = info.description;
            
            return (
              <Show
                when={isSelected()}
                fallback={
                  <box flexDirection="row">
                    <text fg={Colors.ui.text}>{nameCol}</text>
                    <text fg={Colors.ui.dim}>{inputCol}</text>
                    <text fg={Colors.ui.dim}>{desc}</text>
                    <Show when={isCurrent}>
                      <text fg={Colors.status.success}> (current)</text>
                    </Show>
                  </box>
                }
              >
                <box flexDirection="row" backgroundColor={Colors.mode.AGENT}>
                  <text fg="#000000">{nameCol}</text>
                  <text fg="#000000">{inputCol}</text>
                  <text fg="#000000">{desc}</text>
                  <Show when={isCurrent}>
                    <text fg="#006600"> (current)</text>
                  </Show>
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

// Fixed width for logo box and prompt box alignment
const WELCOME_BOX_WIDTH = 76;

// Welcome screen (shown when no messages)
function WelcomeScreen(props: { onSubmit: (value: string) => void }) {
  const { mode, thinking } = useMode();

  // ASCII logo for GLM-CLI - no manual padding, flexbox centers it
  const logo = [
    " ██████╗ ██╗     ███╗   ███╗       ██████╗██╗     ██╗",
    "██╔════╝ ██║     ████╗ ████║      ██╔════╝██║     ██║",
    "██║  ███╗██║     ██╔████╔██║█████╗██║     ██║     ██║",
    "██║   ██║██║     ██║╚██╔╝██║╚════╝██║     ██║     ██║",
    "╚██████╔╝███████╗██║ ╚═╝ ██║      ╚██████╗███████╗██║",
    " ╚═════╝ ╚══════╝╚═╝     ╚═╝       ╚═════╝╚══════╝╚═╝",
  ];

  // Gradient colors from bright cyan to dim (per Design.md)
  // #5cffff → #4ad4d4 → #38a9a9 → #267e7e → #1a6666 → #666666
  const gradientColors = [
    "#5cffff", // Line 0 - brightest cyan
    "#4ad4d4", // Line 1
    "#38a9a9", // Line 2
    "#267e7e", // Line 3
    "#1a6666", // Line 4
    "#666666", // Line 5 - dim
  ];

  // Get version from package.json
  const version = `v${packageJson.version}`;
  // Build date: use current date formatted as MM-DD-YYYY
  const now = new Date();
  const buildDate = `built ${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${now.getFullYear()}`;
  const dir = process.cwd().replace(process.env["HOME"] || "", "~");

  // Info line width for consistent alignment (inside padding)
  // Content area is 70 chars, info lines should span most of it
  const infoWidth = 68;

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Logo section - centered with no flex grow, positioned from top */}
      <box flexDirection="column" alignItems="center" paddingTop={4}>
        {/* Heavy border box with extra padding */}
        <box border borderStyle="heavy" flexDirection="column" width={WELCOME_BOX_WIDTH} paddingTop={2} paddingBottom={1} paddingLeft={2} paddingRight={2}>
          {/* Extra top padding */}
          <box height={1} />
          {/* Logo lines with gradient - centered */}
          {logo.map((line, i) => (
            <box justifyContent="center">
              <text fg={gradientColors[i] || Colors.ui.dim}>{line}</text>
            </box>
          ))}
          {/* Extra padding between logo and version info */}
          <box height={2} />
          {/* Version and build info - centered rows */}
          <box justifyContent="center">
            <box flexDirection="row" justifyContent="space-between" width={infoWidth}>
              <text fg={Colors.ui.dim}>{version}</text>
              <text fg={Colors.ui.dim}>GLM-4.7</text>
            </box>
          </box>
          <box justifyContent="center">
            <box flexDirection="row" justifyContent="space-between" width={infoWidth}>
              <text fg={Colors.ui.dim}>{buildDate}</text>
              <text fg={Colors.ui.dim}>{dir}</text>
            </box>
          </box>
          <box height={1} />
        </box>
        
        {/* 5-line gap between logo box and prompt */}
        <box height={5} />
        
        {/* Input area positioned after the gap - fixed width to match logo box */}
        <box width={WELCOME_BOX_WIDTH}>
          <InputArea mode={mode()} thinking={thinking()} onSubmit={props.onSubmit} />
        </box>
      </box>
      
      {/* Status line anchored below input - centered with same width */}
      <box flexDirection="column" alignItems="center">
        <box width={WELCOME_BOX_WIDTH}>
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

// Main app wrapper
export function App() {
  const renderer = useRenderer();
  
  // Register commands on mount
  onMount(() => {
    initializeCommands();
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

  // Show API key overlay if needed, otherwise show main app
  return (
    <ModeProvider>
      <SessionProvider>
        <TodoProvider>
          <SidebarProvider>
            <box width="100%" height="100%" padding={1}>
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
          </SidebarProvider>
        </TodoProvider>
      </SessionProvider>
    </ModeProvider>
  );
}

// App that decides between welcome screen and session view
function AppWithSession() {
  const { messages, addMessage, updateMessage, model, setModel } = useSession();
  const { mode, thinking, cycleMode, cycleModeReverse } = useMode();
  const { visible: sidebarVisible, toggle: toggleSidebar } = useSidebar();
  const renderer = useRenderer();

  const [isLoading, setIsLoading] = createSignal(false);
  
  // Command result overlay state
  const [commandOverlay, setCommandOverlay] = createSignal<{
    title: string;
    content: string;
    isError: boolean;
  } | null>(null);
  
  // Model select overlay state
  const [showModelSelect, setShowModelSelect] = createSignal(false);

  let ctrlCCount = 0;
  let escCount = 0;
  let streamProcessor: StreamProcessor | null = null;

  // Handle keyboard shortcuts
  useKeyboard((key) => {
    // Double Ctrl+C to exit
    if (key.ctrl && key.name === "c") {
      ctrlCCount++;
      if (ctrlCCount >= 2) {
        renderer.destroy();
      }
      setTimeout(() => {
        ctrlCCount = 0;
      }, 500);
      return;
    }

    // Double Esc to cancel current operation
    if (key.name === "escape") {
      escCount++;
      if (escCount >= 2 && streamProcessor) {
        streamProcessor.abort();
        setIsLoading(false);
        escCount = 0;
      }
      setTimeout(() => {
        escCount = 0;
      }, 500);
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

    // Ctrl+B to toggle sidebar
    if (key.ctrl && key.name === "b") {
      toggleSidebar();
      return;
    }
  });

  // Handle message submission
  const handleSubmit = async (content: string) => {
    if (isLoading()) return;

    const trimmedContent = content.trim();
    if (!trimmedContent) return;

    // Check if this is a command (starts with /)
    if (trimmedContent.startsWith("/")) {
      const parsed = CommandRegistry.parse(trimmedContent);
      
      // Handle /exit and /quit specially - they need renderer.destroy()
      if (parsed && (parsed.name === "exit" || parsed.name === "quit")) {
        // Execute the command to get summary, then exit
        await CommandRegistry.execute(trimmedContent);
        renderer.destroy();
        return;
      }
      
      // Handle /model specially - show interactive selection popup
      // Only if no model name provided (just "/model")
      if (parsed && parsed.name === "model") {
        const hasModelArg = trimmedContent.trim().split(/\s+/).length > 1;
        if (!hasModelArg) {
          setShowModelSelect(true);
          return;
        }
      }

      // Execute other commands - show result in overlay (not as a message)
      const result = await CommandRegistry.execute(trimmedContent);
      
      // Get command name for overlay title
      const cmdName = parsed?.name || trimmedContent.slice(1).split(/\s/)[0] || "Command";
      
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
    // Add user message
    addMessage({ role: "user", content: trimmedContent });

    setIsLoading(true);

    // Add assistant message placeholder
    addMessage({ role: "assistant", content: "" });

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

      // Create stream processor
      streamProcessor = new StreamProcessor();

      let accumulatedContent = "";

      // Handle stream events
      streamProcessor.onEvent((event: StreamEvent) => {
        if (event.type === "content") {
          accumulatedContent += event.delta;
          updateMessage(assistantMsgId, {
            content: accumulatedContent,
          });
        } else if (event.type === "done") {
          setIsLoading(false);
          streamProcessor = null;
        }
      });

      // Start streaming
      const stream = GLMClient.stream({
        messages: apiMessages,
        model: model() as any,
        signal: streamProcessor.getAbortSignal(),
      });

      await streamProcessor.process(stream);
    } catch (error) {
      // Update assistant message with error
      updateMessage(assistantMsgId, {
        content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
      setIsLoading(false);
      streamProcessor = null;
    }
  };

  // Use Show for reactive conditional rendering
  return (
    <>
      <Show
        when={messages().length > 0}
        fallback={<WelcomeScreen onSubmit={handleSubmit} />}
      >
        {/* Session view with padding: 2 top/bottom, 4 left/right */}
        <box 
          flexDirection="column" 
          width="100%" 
          height="100%"
          paddingTop={2}
          paddingBottom={2}
          paddingLeft={4}
          paddingRight={4}
        >
          <box flexDirection="row" flexGrow={1}>
            {/* Chat + Input + Status column */}
            <box flexDirection="column" flexGrow={1}>
              <ChatView messages={messages()} />
              <InputArea
                mode={mode()}
                thinking={thinking()}
                onSubmit={handleSubmit}
              />
              {/* Status line directly under input box */}
              <StatusLine />
            </box>
            {/* Sidebar or collapsed strip based on visibility */}
            <Show
              when={sidebarVisible()}
              fallback={<CollapsedSidebar />}
            >
              <Sidebar />
            </Show>
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
    </>
  );
}
