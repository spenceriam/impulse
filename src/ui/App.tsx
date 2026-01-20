import { render, useRenderer, useKeyboard } from "@opentui/solid";
import { StatusLine, InputArea, ChatView } from "./components";
import { Mode } from "./design";

/**
 * App Component
 * Root OpenTUI component with full-screen layout and exit handling
 */

export function App() {
  const renderer = useRenderer();
  const mode: Mode = "AUTO";
  const thinking = true;

  const messages = [
    { id: "1", role: "user" as const, content: "Hello, can you help me?" },
    { id: "2", role: "assistant" as const, content: "Of course! What would you like help with?" },
  ];

  let ctrlCCount = 0;

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      ctrlCCount++;
      if (ctrlCCount >= 2) {
        renderer.destroy();
      }
      setTimeout(() => {
        ctrlCCount = 0;
      }, 500);
    }
  });

  const handleSubmit = (value: string) => {
    console.log("Submitted:", value);
  };

  return (
    <box flexDirection="column" width="100%" height="100%">
      <ChatView messages={messages} />
      <InputArea mode={mode} thinking={thinking} onSubmit={handleSubmit} />
      <StatusLine />
    </box>
  );
}

render(() => <App />);
