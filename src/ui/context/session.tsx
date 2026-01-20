import { createContext, createSignal, useContext, ParentComponent, Accessor, Setter } from "solid-js";
import { Bus } from "../../bus";
import { TodoEvents } from "../../bus/events";

/**
 * Message type
 */
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

/**
 * Session stats type
 */
export interface SessionStats {
  totalMessages: number;
  totalTokens: number;
  totalCost: number;
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
}

/**
 * Session Context
 */
const SessionContext = createContext<SessionContextType>();

/**
 * Session Provider Component
 * Manages messages, model selection, and stats
 */
export const SessionProvider: ParentComponent = (props) => {
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [model, setModel] = createSignal<string>("GLM-4.7");
  const [thinking, setThinking] = createSignal<boolean>(true);
  const [totalTokens, _setTotalTokens] = createSignal<number>(0);
  const [totalCost, _setTotalCost] = createSignal<number>(0);

  const addMessage = (message: Omit<Message, "id" | "timestamp">) => {
    const newMessage: Message = {
      ...message,
      id: `msg-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, newMessage]);

    Bus.publish(TodoEvents.Updated, {
      sessionID: "default",
      todos: messages() as any,
    });
  };

  const updateMessage = (id: string, updates: Partial<Message>) => {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === id ? { ...msg, ...updates } : msg))
    );
  };

  const stats = () => ({
    totalMessages: messages().length,
    totalTokens: totalTokens(),
    totalCost: totalCost(),
  });

  const contextValue = {
    messages,
    setMessages,
    addMessage,
    updateMessage,
    model,
    setModel,
    thinking,
    setThinking,
    stats,
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
