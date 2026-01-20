import { createContext, createSignal, useContext, ParentComponent, Accessor, Setter } from "solid-js";
import { Bus } from "../../bus";
import { TodoEvents } from "../../bus/events";

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
  const [todos, setTodos] = createSignal<Todo[]>([]);

  const addTodo = (todo: Omit<Todo, "id">) => {
    const newTodo: Todo = {
      ...todo,
      id: `todo-${Date.now()}-${Math.random()}`,
    };
    setTodos((prev) => [...prev, newTodo]);

    Bus.publish(TodoEvents.Updated, {
      sessionID: "default",
      todos: [...todos(), newTodo],
    });
  };

  const updateTodo = (id: string, updates: Partial<Todo>) => {
    setTodos((prev) => {
      const updated = prev.map((todo) => (todo.id === id ? { ...todo, ...updates } : todo));
      Bus.publish(TodoEvents.Updated, {
        sessionID: "default",
        todos: updated,
      });
      return updated;
    });
  };

  const removeTodo = (id: string) => {
    setTodos((prev) => {
      const updated = prev.filter((todo) => todo.id !== id);
      Bus.publish(TodoEvents.Updated, {
        sessionID: "default",
        todos: updated,
      });
      return updated;
    });
  };

  const incompleteTodos = () =>
    todos().filter((todo) => todo.status !== "completed");

  const contextValue = {
    todos,
    setTodos,
    addTodo,
    updateTodo,
    removeTodo,
    incompleteTodos,
  };

  // Subscribe to todo updates from bus
  Bus.subscribe(({ type, properties }) => {
    if (type === TodoEvents.Updated.name) {
      // @ts-ignore: typing for bus events
      setTodos(() => properties.todos);
    }
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
