import { createContext, createSignal, useContext, ParentComponent, Accessor, Setter, onMount, onCleanup } from "solid-js";
import { SessionManager } from "../../session/manager";
import { SessionStoreInstance, Message as StoreMessage, Session } from "../../session/store";
import { type Mode } from "../design";
import { type HeaderPrefix } from "../components/HeaderLine";

/**
 * Message type (UI-friendly version)
 */
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  mode?: Mode;    // Mode used when generating this message (for assistant messages)
  model?: string; // Model used (e.g., "glm-4.7")
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
  // Session operations
  createNewSession: () => Promise<void>;
  loadSession: (sessionId: string) => Promise<void>;
  saveSession: (name?: string) => Promise<void>;
  listSessions: () => Promise<Session[]>;
}

/**
 * Session Context
 */
const SessionContext = createContext<SessionContextType>();

/**
 * Convert store message to UI message
 */
function storeToUiMessage(msg: StoreMessage, index: number): Message {
  return {
    id: `msg-${index}-${Date.parse(msg.timestamp)}`,
    role: msg.role === "system" ? "assistant" : msg.role,
    content: msg.content,
    timestamp: Date.parse(msg.timestamp),
  };
}

/**
 * Convert UI message to store message
 */
function uiToStoreMessage(msg: Message): StoreMessage {
  return {
    role: msg.role,
    content: msg.content,
    timestamp: new Date(msg.timestamp).toISOString(),
  };
}

/**
 * Session Provider Component
 * Manages messages, model selection, and stats with persistence via SessionManager
 */
export const SessionProvider: ParentComponent = (props) => {
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [model, setModel] = createSignal<string>("glm-4.7");
  const [thinking, setThinking] = createSignal<boolean>(true);
  const [totalTokens, _setTotalTokens] = createSignal<number>(0);
  const [totalCost, setTotalCost] = createSignal<number>(0);
  const [sessionId, setSessionId] = createSignal<string | null>(null);
  const [sessionName, setSessionName] = createSignal<string | null>(null);
  
  // Header state
  const [headerTitle, setHeaderTitleSignal] = createSignal<string>("New session");
  const [headerPrefix, setHeaderPrefix] = createSignal<HeaderPrefix>(null);
  
  // Set header title with optional prefix clearing
  const setHeaderTitle = (title: string, clearPrefix: boolean = true) => {
    setHeaderTitleSignal(title);
    if (clearPrefix) {
      setHeaderPrefix(null);
    }
  };

  // Auto-save interval
  let autoSaveInterval: ReturnType<typeof setInterval> | null = null;
  const AUTO_SAVE_INTERVAL_MS = 30000; // 30 seconds

  // Initialize session on mount
  onMount(async () => {
    try {
      // Try to get current session or create new one
      let session = SessionManager.getCurrentSession();
      
      if (!session) {
        // Create a new session
        session = await SessionManager.createNew();
      }

      // Load session data into context
      loadSessionIntoContext(session);

      // Start auto-save
      startAutoSave();
    } catch (error) {
      console.error("Failed to initialize session:", error);
      // Create empty session state
      setSessionId(null);
      setSessionName(null);
    }
  });

  // Cleanup on unmount
  onCleanup(() => {
    stopAutoSave();
  });

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

  // Start auto-save interval
  const startAutoSave = () => {
    if (autoSaveInterval) return;
    
    autoSaveInterval = setInterval(async () => {
      const currentSessionId = sessionId();
      if (currentSessionId && messages().length > 0) {
        try {
          const storeMessages = messages().map(uiToStoreMessage);
          SessionStoreInstance.autoSave(currentSessionId, {
            messages: storeMessages,
            model: model(),
            cost: totalCost(),
          });
        } catch (error) {
          console.error("Auto-save failed:", error);
        }
      }
    }, AUTO_SAVE_INTERVAL_MS);
  };

  // Stop auto-save interval
  const stopAutoSave = () => {
    if (autoSaveInterval) {
      clearInterval(autoSaveInterval);
      autoSaveInterval = null;
    }
  };

  // Add a new message
  const addMessage = (message: Omit<Message, "id" | "timestamp">) => {
    const newMessage: Message = {
      ...message,
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, newMessage]);

    // Persist to SessionManager if we have an active session
    const currentSessionId = sessionId();
    if (currentSessionId) {
      // Use autoSave for debounced persistence
      SessionStoreInstance.autoSave(currentSessionId, {
        messages: messages().map(uiToStoreMessage),
      });
    }
  };

  // Update an existing message
  const updateMessage = (id: string, updates: Partial<Message>) => {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === id ? { ...msg, ...updates } : msg))
    );

    // Persist changes
    const currentSessionId = sessionId();
    if (currentSessionId) {
      SessionStoreInstance.autoSave(currentSessionId, {
        messages: messages().map(uiToStoreMessage),
      });
    }
  };

  // Create a new session
  const createNewSession = async () => {
    stopAutoSave();
    
    try {
      const session = await SessionManager.createNew();
      loadSessionIntoContext(session);
      setMessages([]); // Clear messages for new session
      setHeaderTitle("New session", true); // Reset header for new session
      startAutoSave();
    } catch (error) {
      console.error("Failed to create new session:", error);
      throw error;
    }
  };

  // Load an existing session
  const loadSession = async (targetSessionId: string) => {
    stopAutoSave();
    
    try {
      const session = await SessionManager.load(targetSessionId);
      loadSessionIntoContext(session);
      startAutoSave();
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

  // Compute stats
  const stats = () => ({
    totalMessages: messages().length,
    totalTokens: totalTokens(),
    totalCost: totalCost(),
    sessionId: sessionId(),
    sessionName: sessionName(),
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
    // Session operations
    createNewSession,
    loadSession,
    saveSession,
    listSessions,
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
