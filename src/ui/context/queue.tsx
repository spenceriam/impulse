import { createContext, createSignal, useContext, ParentComponent, Accessor, createMemo } from "solid-js";
import { Bus } from "../../bus";
import { QueueEvents } from "../../bus/events";

/**
 * Queued message type
 */
export interface QueuedMessage {
  id: string;
  content: string;
  timestamp: number;
}

/**
 * Queue Context Type
 */
interface QueueContextType {
  /** All queued messages */
  messages: Accessor<QueuedMessage[]>;
  /** Number of messages in queue */
  count: Accessor<number>;
  /** Add a message to the queue */
  enqueue: (content: string) => void;
  /** Remove a message by ID */
  remove: (id: string) => void;
  /** Update a message's content */
  update: (id: string, content: string) => void;
  /** Move a message up in the queue */
  moveUp: (id: string) => void;
  /** Move a message down in the queue */
  moveDown: (id: string) => void;
  /** Get and remove the first message (for sending) */
  dequeue: () => QueuedMessage | undefined;
  /** Clear all messages */
  clear: () => void;
  /** Check if queue has messages */
  hasMessages: Accessor<boolean>;
}

/**
 * Queue Context
 */
const QueueContext = createContext<QueueContextType>();

/**
 * Generate unique ID for queue messages
 */
function generateId(): string {
  return `queue-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Queue Provider Component
 * Manages message queue for typing while AI is processing
 */
export const QueueProvider: ParentComponent = (props) => {
  const [messages, setMessages] = createSignal<QueuedMessage[]>([]);

  const count = createMemo(() => messages().length);
  const hasMessages = createMemo(() => messages().length > 0);

  const enqueue = (content: string) => {
    const message: QueuedMessage = {
      id: generateId(),
      content,
      timestamp: Date.now(),
    };
    
    setMessages((prev) => [...prev, message]);
    
    Bus.publish(QueueEvents.Added, { message });
  };

  const remove = (id: string) => {
    setMessages((prev) => {
      const updated = prev.filter((m) => m.id !== id);
      Bus.publish(QueueEvents.Updated, { messages: updated });
      return updated;
    });
    
    Bus.publish(QueueEvents.Removed, { id });
  };

  const update = (id: string, content: string) => {
    setMessages((prev) => {
      const updated = prev.map((m) => 
        m.id === id ? { ...m, content } : m
      );
      Bus.publish(QueueEvents.Updated, { messages: updated });
      return updated;
    });
  };

  const moveUp = (id: string) => {
    setMessages((prev) => {
      const index = prev.findIndex((m) => m.id === id);
      if (index <= 0) return prev;
      
      const updated = [...prev];
      const current = updated[index];
      const above = updated[index - 1];
      if (current && above) {
        updated[index - 1] = current;
        updated[index] = above;
      }
      Bus.publish(QueueEvents.Updated, { messages: updated });
      return updated;
    });
  };

  const moveDown = (id: string) => {
    setMessages((prev) => {
      const index = prev.findIndex((m) => m.id === id);
      if (index < 0 || index >= prev.length - 1) return prev;
      
      const updated = [...prev];
      const current = updated[index];
      const below = updated[index + 1];
      if (current && below) {
        updated[index] = below;
        updated[index + 1] = current;
      }
      Bus.publish(QueueEvents.Updated, { messages: updated });
      return updated;
    });
  };

  const dequeue = (): QueuedMessage | undefined => {
    const current = messages();
    if (current.length === 0) return undefined;
    
    const first = current[0];
    const rest = current.slice(1);
    
    if (!first) return undefined;
    
    setMessages(rest);
    
    Bus.publish(QueueEvents.Sending, { id: first.id });
    Bus.publish(QueueEvents.Updated, { messages: rest });
    
    return first;
  };

  const clear = () => {
    setMessages([]);
    Bus.publish(QueueEvents.Updated, { messages: [] });
  };

  const contextValue: QueueContextType = {
    messages,
    count,
    enqueue,
    remove,
    update,
    moveUp,
    moveDown,
    dequeue,
    clear,
    hasMessages,
  };

  return (
    <QueueContext.Provider value={contextValue}>
      {props.children}
    </QueueContext.Provider>
  );
};

/**
 * Hook to use Queue Context
 */
export function useQueue() {
  const context = useContext(QueueContext);
  if (!context) {
    throw new Error("useQueue must be used within QueueProvider");
  }
  return context;
}
