import { createSignal, createEffect, Show } from "solid-js";
import { useRenderer, useKeyboard } from "@opentui/solid";
import type { PasteEvent, TextareaRenderable } from "@opentui/core";
import { StatusLine, InputArea, ChatView, Sidebar } from "./components";
import { ModeProvider, useMode } from "./context/mode";
import { SessionProvider, useSession } from "./context/session";
import { TodoProvider } from "./context/todo";
import { load as loadConfig, save as saveConfig } from "../util/config";
import { GLMClient } from "../api/client";
import { StreamProcessor, StreamEvent } from "../api/stream";
import { Colors } from "./design";

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
  let textareaRef: TextareaRenderable | undefined;

  useKeyboard((key) => {
    // Submit on Enter (but not Shift+Enter for newlines)
    if (key.name === "enter" && !key.shift) {
      const trimmedKey = apiKey().trim();
      if (trimmedKey) {
        if (trimmedKey.length < 10) {
          setError("API key seems too short. Please check and try again.");
          return;
        }
        setError("");
        props.onSave(trimmedKey);
      }
      return;
    }
    
    // Cancel on Escape
    if (key.name === "escape") {
      props.onCancel();
      return;
    }
  });

  // Handle paste events on textarea
  const handlePaste = (event: PasteEvent) => {
    // Normalize line endings and trim
    const pastedText = event.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if (pastedText) {
      // For API key, we want to replace the entire content with pasted text
      // (user is likely pasting their full API key)
      setApiKey(pastedText);
      setError("");
      // Prevent default so textarea doesn't also insert the text
      event.preventDefault();
      // Update the textarea display
      if (textareaRef) {
        textareaRef.clear();
        textareaRef.insertText(pastedText);
      }
    }
  };

  // Handle content changes from textarea
  const handleContentChange = () => {
    if (textareaRef) {
      // Remove newlines for API key (should be single line)
      const cleanValue = textareaRef.plainText.replace(/\n/g, "");
      setApiKey(cleanValue);
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
          <textarea
            ref={(r: TextareaRenderable) => { textareaRef = r; }}
            onContentChange={handleContentChange}
            onPaste={handlePaste}
            focused
            width={50}
            height={1}
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

// Welcome screen (shown when no messages)
function WelcomeScreen(props: { onSubmit: (value: string) => void }) {
  const { mode, thinking } = useMode();

  // ASCII logo for GLM-CLI
  const logo = [
    "  ██████╗ ██╗     ███╗   ███╗       ██████╗██╗     ██╗",
    " ██╔════╝ ██║     ████╗ ████║      ██╔════╝██║     ██║",
    " ██║  ███╗██║     ██╔████╔██║█████╗██║     ██║     ██║",
    " ██║   ██║██║     ██║╚██╔╝██║╚════╝██║     ██║     ██║",
    " ╚██████╔╝███████╗██║ ╚═╝ ██║      ╚██████╗███████╗██║",
    "  ╚═════╝ ╚══════╝╚═╝     ╚═╝       ╚═════╝╚══════╝╚═╝",
  ];

  const version = "v0.2.0";
  const buildDate = "01-20-2026";
  const dir = process.cwd().replace(process.env["HOME"] || "", "~");

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center">
        <box border flexDirection="column" padding={2}>
          {logo.map((line, i) => (
            <text fg={i < 3 ? Colors.mode.AGENT : Colors.ui.dim}>{line}</text>
          ))}
          <box height={1} />
          <box flexDirection="row" justifyContent="space-between" width={56}>
            <text fg={Colors.ui.dim}>{version}</text>
            <text fg={Colors.ui.dim}>built {buildDate}</text>
          </box>
          <box flexDirection="row" justifyContent="space-between" width={56}>
            <text fg={Colors.ui.dim}>Model: GLM-4.7</text>
            <text fg={Colors.ui.dim}>Dir: {dir}</text>
          </box>
        </box>
      </box>
      <InputArea mode={mode()} thinking={thinking()} onSubmit={props.onSubmit} />
      <StatusLine />
    </box>
  );
}

// Main app wrapper
export function App() {
  const renderer = useRenderer();
  
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
          <box width="100%" height="100%">
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
        </TodoProvider>
      </SessionProvider>
    </ModeProvider>
  );
}

// App that decides between welcome screen and session view
function AppWithSession() {
  const { messages, addMessage, updateMessage, model } = useSession();
  const { mode, thinking, cycleMode, cycleModeReverse } = useMode();
  const renderer = useRenderer();

  const [isLoading, setIsLoading] = createSignal(false);

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
  });

  // Handle message submission
  const handleSubmit = async (content: string) => {
    if (isLoading()) return;

    // Add user message
    addMessage({ role: "user", content });

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
      const apiMessages = updatedMessages
        .filter((m) => m.id !== assistantMsgId)
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

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

  // Show welcome screen if no messages
  if (messages().length === 0) {
    return <WelcomeScreen onSubmit={handleSubmit} />;
  }

  // Show session view with messages
  return (
    <box flexDirection="column" width="100%" height="100%">
      <box flexDirection="row" flexGrow={1}>
        <box flexDirection="column" flexGrow={1}>
          <ChatView messages={messages()} />
          <InputArea
            mode={mode()}
            thinking={thinking()}
            onSubmit={handleSubmit}
          />
        </box>
        <Sidebar />
      </box>
      <StatusLine />
    </box>
  );
}
