import { createContext, createSignal, createEffect, useContext, ParentComponent, Accessor, Setter, onCleanup } from "solid-js";
import { SessionManager } from "../../session/manager";
import { SessionStoreInstance, Message as StoreMessage, Session } from "../../session/store";
import { type HeaderPrefix } from "../components/HeaderLine";
import { type Message as MessageBlockMessage, type ToolCallInfo } from "../components/MessageBlock";
import { type Mode } from "../design";

/**
 * Message type (UI-friendly version, extends MessageBlock's Message)
 */
export interface Message extends MessageBlockMessage {
  timestamp: number;
}

// Re-export ToolCallInfo for convenience
export type { ToolCallInfo };

/**
 * Token usage stats
 */
export interface TokenStats {
  input: number;
  output: number;
  thinking: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Tool call stats
 */
export interface ToolStats {
  total: number;
  success: number;
  failed: number;
  byName: Record<string, number>;  // Count per tool name
}

/**
 * Session stats type
 */
export interface SessionStats {
  totalMessages: number;
  totalTokens: number;
  totalCost: number;
  sessionId: string | null;
  sessionName: string | null;
  tokens: TokenStats;
  tools: ToolStats;
  lastPromptTokens: number;  // Actual prompt tokens from last API call (for context %)
}

/**
 * Session Context Type
 */
interface SessionContextType {
  messages: Accessor<Message[]>;
  setMessages: Setter<Message[]>;
  addMessage: (message: Omit<Message, "id" | "timestamp">) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  model: Accessor<string>;
  setModel: Setter<string>;
  thinking: Accessor<boolean>;
  setThinking: Setter<boolean>;
  stats: Accessor<SessionStats>;
  sessionId: Accessor<string | null>;
  sessionName: Accessor<string | null>;
  // Header state
  headerTitle: Accessor<string>;
  setHeaderTitle: (title: string, clearPrefix?: boolean) => void;
  headerPrefix: Accessor<HeaderPrefix>;
  setHeaderPrefix: Setter<HeaderPrefix>;
  // Tool display verbosity (toggleable via /verbose)
  verboseTools: Accessor<boolean>;
  setVerboseTools: Setter<boolean>;
  // Stats tracking
  addTokenUsage: (usage: Partial<TokenStats>) => void;
  recordToolCall: (name: string, success: boolean) => void;
  // Session operations
  createNewSession: () => Promise<void>;
  loadSession: (sessionId: string) => Promise<void>;
  saveSession: (name?: string) => Promise<void>;
  listSessions: () => Promise<Session[]>;
  // Lazy session creation and save triggers
  ensureSessionCreated: () => Promise<string>;  // Returns session ID
  saveAfterResponse: () => Promise<void>;       // Call after AI response completes
  saveOnExit: () => Promise<void>;              // Call on clean exit
  isDirty: Accessor<boolean>;                   // True if unsaved changes exist
}

/**
 * Session Context
 */
const SessionContext = createContext<SessionContextType>();

/**
 * Convert store message to UI message
 */
function storeToUiMessage(msg: StoreMessage, index: number): Message {
  // Convert store tool_calls to UI toolCalls format
  let toolCalls: ToolCallInfo[] | undefined;
  if (msg.tool_calls && msg.tool_calls.length > 0) {
    toolCalls = msg.tool_calls.map((tc, i) => {
      const status: "pending" | "running" | "success" | "error" = tc.result 
        ? (tc.result.success ? "success" : "error") 
        : "success";  // If no result recorded, assume success (historical data)
      
      const info: ToolCallInfo = {
        id: `tc-${index}-${i}`,
        name: tc.tool,
        arguments: JSON.stringify(tc.arguments, null, 2),
        status,
      };
      
      // Only add result if it exists
      const resultText = tc.result?.output || tc.result?.error;
      if (resultText) {
        info.result = resultText;
      }
      
      return info;
    });
  }

  const result: Message = {
    id: `msg-${index}-${Date.parse(msg.timestamp)}`,
    role: msg.role === "system" ? "assistant" : msg.role,
    content: msg.content,
    timestamp: Date.parse(msg.timestamp),
  };
  
  // Only add optional fields if they have values
  if (msg.reasoning_content) {
    result.reasoning = msg.reasoning_content;
  }
  if (toolCalls) {
    result.toolCalls = toolCalls;
  }
  // Restore mode and model for proper display coloring
  if (msg.mode) {
    result.mode = msg.mode as Mode;
  }
  if (msg.model) {
    result.model = msg.model;
  }
  
  return result;
}

/**
 * Convert UI message to store message
 */
function uiToStoreMessage(msg: Message): StoreMessage {
  const result: StoreMessage = {
    role: msg.role,
    content: msg.content,
    timestamp: new Date(msg.timestamp).toISOString(),
  };
  
  // Only add optional fields if they have values
  if (msg.reasoning) {
    result.reasoning_content = msg.reasoning;
  }
  
  // Convert UI toolCalls to store tool_calls format
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    result.tool_calls = msg.toolCalls.map(tc => {
      const toolCall: any = {
        tool: tc.name,
        arguments: tc.arguments ? JSON.parse(tc.arguments) : {},
        timestamp: new Date(msg.timestamp).toISOString(),
      };
      
      if (tc.result) {
        toolCall.result = {
          success: tc.status === "success",
          ...(tc.status === "success" ? { output: tc.result } : { error: tc.result }),
        };
      }
      
      return toolCall;
    });
  }
  
  // Save mode and model for proper display coloring on load
  if (msg.mode) {
    result.mode = msg.mode;
  }
  if (msg.model) {
    result.model = msg.model;
  }

  return result;
}

/**
 * Session Provider Props
 */
interface SessionProviderProps {
  initialModel?: string;
  initialSessionId?: string;
  children?: any;
}

/**
 * Session Provider Component
 * Manages messages, model selection, and stats with persistence via SessionManager
 */
export const SessionProvider: ParentComponent<SessionProviderProps> = (props) => {
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [model, setModel] = createSignal<string>(props.initialModel ?? "glm-4.7");
  const [thinking, setThinking] = createSignal<boolean>(true);
  const [totalTokens, setTotalTokens] = createSignal<number>(0);
  const [totalCost, setTotalCost] = createSignal<number>(0);
  const [sessionId, setSessionId] = createSignal<string | null>(null);
  const [sessionName, setSessionName] = createSignal<string | null>(null);
  
  // Track if session has been persisted to disk (lazy creation)
  const [sessionPersisted, setSessionPersisted] = createSignal<boolean>(false);
  // Track if there are unsaved changes
  const [isDirty, setIsDirty] = createSignal<boolean>(false);
  
  // Token and tool stats tracking
  const [tokenStats, setTokenStats] = createSignal<TokenStats>({
    input: 0,
    output: 0,
    thinking: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
  const [toolStats, setToolStats] = createSignal<ToolStats>({
    total: 0,
    success: 0,
    failed: 0,
    byName: {},
  });
  
  // Track last prompt tokens for accurate context % calculation
  // This is the actual token count from the most recent API response
  const [lastPromptTokens, setLastPromptTokens] = createSignal<number>(0);
  
  // Header state
  const [headerTitle, setHeaderTitleSignal] = createSignal<string>("New session");
  const [headerPrefix, setHeaderPrefix] = createSignal<HeaderPrefix>(null);
  
  // Tool display verbosity (default: false = compact display)
  const [verboseTools, setVerboseTools] = createSignal<boolean>(false);
  
  // Set header title with optional prefix clearing
  const setHeaderTitle = (title: string, clearPrefix: boolean = true) => {
    setHeaderTitleSignal(title);
    if (clearPrefix) {
      setHeaderPrefix(null);
    }
  };

  // No auto-save interval - we use event-driven saves instead
  // Session is created lazily on first user message

  // Initialize: Don't create session yet, just prepare empty state
  // Session will be created on first message via ensureSessionCreated()

  // Cleanup on unmount - no interval to stop
  onCleanup(() => {
    // Cancel any pending debounced saves
    const currentId = sessionId();
    if (currentId) {
      SessionStoreInstance.cancelAutoSave(currentId);
    }
  });

  // Load initial session if provided via CLI flag (-s/--session)
  if (props.initialSessionId) {
    // Use createEffect to load async
    createEffect(async () => {
      try {
        const session = await SessionManager.load(props.initialSessionId!);
        loadSessionIntoContext(session);
        setSessionPersisted(true);
        setIsDirty(false);
      } catch (error) {
        console.error(`Failed to load session ${props.initialSessionId}:`, error);
      }
    });
  }

  // Load session data into context signals
  const loadSessionIntoContext = (session: Session) => {
    setSessionId(session.id);
    setSessionName(session.name);
    setModel(session.model);
    
    // Convert store messages to UI messages
    const uiMessages = session.messages.map(storeToUiMessage);
    setMessages(uiMessages);
    
    setTotalCost(session.cost);
    
    // Restore header title if saved, otherwise reset
    // The session store may have a headerTitle field (added later)
    const savedTitle = (session as any).headerTitle;
    if (savedTitle) {
      setHeaderTitle(savedTitle, true);
    } else {
      setHeaderTitle("New session", true);
    }
  };

  /**
   * Ensure session is created (lazy creation on first message).
   * Returns the session ID.
   */
  const ensureSessionCreated = async (): Promise<string> => {
    // If already have a persisted session, return its ID
    if (sessionPersisted() && sessionId()) {
      return sessionId()!;
    }

    try {
      const session = await SessionManager.createNew();
      loadSessionIntoContext(session);
      setSessionPersisted(true);
      setIsDirty(false);
      return session.id;
    } catch (error) {
      console.error("Failed to create session:", error);
      throw error;
    }
  };

  /**
   * Save after AI response completes.
   * This is the primary save trigger - called after each complete exchange.
   */
  const saveAfterResponse = async (): Promise<void> => {
    const currentSessionId = sessionId();
    if (!currentSessionId || !sessionPersisted()) {
      return; // No session to save
    }

    if (messages().length === 0) {
      return; // Don't save empty sessions
    }

    try {
      const storeMessages = messages().map(uiToStoreMessage);
      await SessionStoreInstance.update(currentSessionId, {
        messages: storeMessages,
        model: model(),
        cost: totalCost(),
        headerTitle: headerTitle(),
      });
      setIsDirty(false);
    } catch (error) {
      console.error("Failed to save after response:", error);
    }
  };

  /**
   * Save on clean exit (/quit, /exit).
   * Forces an immediate save of all current state.
   */
  const saveOnExit = async (): Promise<void> => {
    const currentSessionId = sessionId();
    if (!currentSessionId || !sessionPersisted()) {
      return;
    }

    if (messages().length === 0) {
      // Delete empty session on exit
      try {
        await SessionManager.deleteSession(currentSessionId);
      } catch (e) {
        // Ignore deletion errors
      }
      return;
    }

    try {
      // Cancel any pending debounced saves
      SessionStoreInstance.cancelAutoSave(currentSessionId);
      
      // Immediate save
      const storeMessages = messages().map(uiToStoreMessage);
      await SessionStoreInstance.update(currentSessionId, {
        messages: storeMessages,
        model: model(),
        cost: totalCost(),
        headerTitle: headerTitle(),
      });
      setIsDirty(false);
    } catch (error) {
      console.error("Failed to save on exit:", error);
    }
  };

  // Add a new message (does NOT auto-save - caller should use saveAfterResponse)
  const addMessage = (message: Omit<Message, "id" | "timestamp">) => {
    const newMessage: Message = {
      ...message,
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, newMessage]);
    setIsDirty(true);
  };

  // Update an existing message (does NOT auto-save - caller should use saveAfterResponse)
  const updateMessage = (id: string, updates: Partial<Message>) => {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === id ? { ...msg, ...updates } : msg))
    );
    setIsDirty(true);
  };

  // Create a new session (resets state for fresh start)
  const createNewSession = async () => {
    // Save current session if dirty
    if (isDirty() && sessionPersisted()) {
      await saveOnExit();
    }
    
    // Reset to unpersisted state
    setSessionId(null);
    setSessionName(null);
    setSessionPersisted(false);
    setMessages([]);
    setHeaderTitle("New session", true);
    setIsDirty(false);
    
    // Reset stats
    setTotalTokens(0);
    setTotalCost(0);
    setTokenStats({ input: 0, output: 0, thinking: 0, cacheRead: 0, cacheWrite: 0 });
    setToolStats({ total: 0, success: 0, failed: 0, byName: {} });
    setLastPromptTokens(0);  // Reset context tracking
  };

  // Load an existing session
  const loadSession = async (targetSessionId: string) => {
    // Save current session if dirty
    if (isDirty() && sessionPersisted()) {
      await saveOnExit();
    }
    
    try {
      const session = await SessionManager.load(targetSessionId);
      loadSessionIntoContext(session);
      setSessionPersisted(true);
      setIsDirty(false);
    } catch (error) {
      console.error("Failed to load session:", error);
      throw error;
    }
  };

  // Save current session with optional name
  const saveSession = async (name?: string) => {
    const currentSessionId = sessionId();
    if (!currentSessionId) {
      throw new Error("No active session to save");
    }

    try {
      // Persist current state immediately (including header title)
      const storeMessages = messages().map(uiToStoreMessage);
      await SessionStoreInstance.update(currentSessionId, {
        messages: storeMessages,
        model: model(),
        cost: totalCost(),
        headerTitle: headerTitle(), // Persist header title
        ...(name ? { name } : {}),
      });

      if (name) {
        setSessionName(name);
      }
    } catch (error) {
      console.error("Failed to save session:", error);
      throw error;
    }
  };

  // List all sessions
  const listSessions = async (): Promise<Session[]> => {
    return await SessionManager.listSessions();
  };

  // Add token usage
  // The `input` field here is the prompt_tokens from the API response - this is
  // the actual context size for the request that just completed
  const addTokenUsage = (usage: Partial<TokenStats>) => {
    setTokenStats((prev) => ({
      input: prev.input + (usage.input ?? 0),
      output: prev.output + (usage.output ?? 0),
      thinking: prev.thinking + (usage.thinking ?? 0),
      cacheRead: prev.cacheRead + (usage.cacheRead ?? 0),
      cacheWrite: prev.cacheWrite + (usage.cacheWrite ?? 0),
    }));
    // Update total tokens
    const total = (usage.input ?? 0) + (usage.output ?? 0) + (usage.thinking ?? 0);
    setTotalTokens((prev) => prev + total);
    
    // Track last prompt tokens for context % calculation
    // This is the actual context size from the most recent API call
    if (usage.input !== undefined && usage.input > 0) {
      setLastPromptTokens(usage.input);
    }
  };

  // Record tool call
  const recordToolCall = (name: string, success: boolean) => {
    setToolStats((prev) => ({
      total: prev.total + 1,
      success: prev.success + (success ? 1 : 0),
      failed: prev.failed + (success ? 0 : 1),
      byName: {
        ...prev.byName,
        [name]: (prev.byName[name] ?? 0) + 1,
      },
    }));
  };

  // Compute stats
  const stats = () => ({
    totalMessages: messages().length,
    totalTokens: totalTokens(),
    totalCost: totalCost(),
    sessionId: sessionId(),
    sessionName: sessionName(),
    tokens: tokenStats(),
    tools: toolStats(),
    lastPromptTokens: lastPromptTokens(),  // Actual context size from last API call
  });

  const contextValue: SessionContextType = {
    messages,
    setMessages,
    addMessage,
    updateMessage,
    model,
    setModel,
    thinking,
    setThinking,
    stats,
    sessionId,
    sessionName,
    // Header state
    headerTitle,
    setHeaderTitle,
    headerPrefix,
    setHeaderPrefix,
    // Tool display verbosity
    verboseTools,
    setVerboseTools,
    // Stats tracking
    addTokenUsage,
    recordToolCall,
    // Session operations
    createNewSession,
    loadSession,
    saveSession,
    listSessions,
    // Lazy session creation and save triggers
    ensureSessionCreated,
    saveAfterResponse,
    saveOnExit,
    isDirty,
  };

  return (
    <SessionContext.Provider value={contextValue}>
      {props.children}
    </SessionContext.Provider>
  );
};

/**
 * Hook to use Session Context
 */
export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return context;
}
