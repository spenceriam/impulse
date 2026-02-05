import { createContext, createSignal, useContext, ParentComponent, Accessor, Setter, onCleanup, createEffect } from "solid-js";
import { Bus } from "../../bus";
import { TodoEvents } from "../../bus/events";
import { Todo as TodoStore } from "../../session/todo";
import { useSession } from "./session";

/**
 * Todo type
 */
export interface Todo {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "high" | "medium" | "low";
}

/**
 * Todo Context Type
 */
interface TodoContextType {
  todos: Accessor<Todo[]>;
  setTodos: Setter<Todo[]>;
  addTodo: (todo: Omit<Todo, "id">) => void;
  updateTodo: (id: string, updates: Partial<Todo>) => void;
  removeTodo: (id: string) => void;
  incompleteTodos: Accessor<Todo[]>;
}

/**
 * Todo Context
 */
const TodoContext = createContext<TodoContextType>();

/**
 * Todo Provider Component
 * Manages todo list with bus event subscription
 */
export const TodoProvider: ParentComponent = (props) => {
  const { sessionId } = useSession();
  const [todos, setTodos] = createSignal<Todo[]>([]);
  let didReceiveUpdate = false;
  let lastScopeId = "";

  const getScopeId = () => sessionId() ?? "";

  const addTodo = (todo: Omit<Todo, "id">) => {
    const newTodo: Todo = {
      ...todo,
      id: `todo-${Date.now()}-${Math.random()}`,
    };
    const next = [...todos(), newTodo];
    setTodos(() => next);
    void TodoStore.update(next, getScopeId());
  };

  const updateTodo = (id: string, updates: Partial<Todo>) => {
    setTodos((prev) => {
      const updated = prev.map((todo) => (todo.id === id ? { ...todo, ...updates } : todo));
      void TodoStore.update(updated, getScopeId());
      return updated;
    });
  };

  const removeTodo = (id: string) => {
    setTodos((prev) => {
      const updated = prev.filter((todo) => todo.id !== id);
      void TodoStore.update(updated, getScopeId());
      return updated;
    });
  };

  const incompleteTodos = () =>
    todos().filter((todo) => todo.status !== "completed" && todo.status !== "cancelled");

  const contextValue = {
    todos,
    setTodos,
    addTodo,
    updateTodo,
    removeTodo,
    incompleteTodos,
  };

  // Subscribe to todo updates from bus
  const unsubscribe = Bus.subscribe(({ type, properties }) => {
    if (type === TodoEvents.Updated.name) {
      const payload = properties as { sessionID?: string; todos?: Todo[] };
      if (payload.sessionID !== getScopeId()) return;
      didReceiveUpdate = true;
      setTodos(() => (Array.isArray(payload.todos) ? payload.todos : []));
    }
  });

  onCleanup(() => {
    unsubscribe();
  });

  // Load persisted todos on scope changes (project/session)
  createEffect(() => {
    const scopeId = getScopeId();
    if (scopeId === lastScopeId) return;
    lastScopeId = scopeId;
    didReceiveUpdate = false;
    if (!scopeId) {
      setTodos(() => []);
      return;
    }
    void (async () => {
      try {
        const existing = await TodoStore.get(scopeId);
        if (!didReceiveUpdate) {
          setTodos(() => existing);
        }
      } catch {
        // Ignore read errors, fallback to empty list
      }
    })();
  });

  return (
    <TodoContext.Provider value={contextValue}>
      {props.children}
    </TodoContext.Provider>
  );
};

/**
 * Hook to use Todo Context
 */
export function useTodo() {
  const context = useContext(TodoContext);
  if (!context) {
    throw new Error("useTodo must be used within TodoProvider");
  }
  return context;
}
