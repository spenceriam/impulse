import { useKeyboard } from "@opentui/solid";
import { Colors } from "../design";

/**
 * StartOverlay Component
 * Welcome screen shown on first launch, accessible via /start command
 * 
 * Soft, friendly introduction to GLM-CLI with key info about the tool.
 */

interface StartOverlayProps {
  onClose: () => void;
}

// Content constants
const SEPARATOR = "───────────────────────────────────────────────────────────────────────────";

const MCP_SERVERS = [
  { name: "Vision MCP", desc: "Image/video analysis, UI screenshots, diagrams" },
  { name: "Web Search MCP", desc: "Real-time web search via webSearchPrime" },
  { name: "Web Reader MCP", desc: "Fetch and parse web content" },
  { name: "Zread MCP", desc: "Documentation search, repo structure, file reading" },
  { name: "Context7 MCP", desc: "Library documentation lookup" },
];

export function StartOverlay(props: StartOverlayProps) {
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
        title="Welcome to GLM-CLI"
        flexDirection="column"
        width={85}
        height={30}
        backgroundColor="#1a1a1a"
      >
        {/* Scrollable content area */}
        <scrollbox
          flexGrow={1}
          style={{
            viewportOptions: {
              paddingLeft: 2,
              paddingRight: 2,
              paddingTop: 1,
              paddingBottom: 1,
            },
          }}
        >
          <box flexDirection="column">
            {/* Welcome and intro */}
            <text fg={Colors.ui.text}>Welcome! GLM-CLI is a terminal-based AI coding agent with a brutally</text>
            <text fg={Colors.ui.text}>minimal UI. It provides flicker-free streaming, tool execution, and</text>
            <text fg={Colors.ui.text}>session management for developers who prefer working in the terminal.</text>
            <box height={1} />
            <text fg={Colors.ui.dim}>{SEPARATOR}</text>
            <box height={1} />

            {/* MCP servers section */}
            <text fg={Colors.ui.text}>This is an agentic coding harness focused on Z.ai/Zhipu's GLM-4.x models</text>
            <text fg={Colors.ui.text}>with supporting MCP servers designed by the Z.ai team:</text>
            <box height={1} />
            {MCP_SERVERS.map((server) => (
              <box flexDirection="row">
                <text fg={Colors.ui.dim}>  - </text>
                <text fg={Colors.ui.text}>{server.name.padEnd(16)}</text>
                <text fg={Colors.ui.dim}>{server.desc}</text>
              </box>
            ))}
            <box height={1} />
            <text fg={Colors.ui.dim}>{SEPARATOR}</text>
            <box height={1} />

            {/* Target users and sessions */}
            <text fg={Colors.ui.text}>Built for developers on the Z.ai Coding Plan who want a focused harness</text>
            <text fg={Colors.ui.text}>with integrated MCP tools. Run from any working directory - sessions are</text>
            <text fg={Colors.ui.text}>stored per-directory so you can return to previous conversations.</text>
            <box height={1} />
            <text fg={Colors.ui.text}>Uses Z.ai Coding Plan APIs on OpenTUI with tool calling. Supports 5 modes:</text>
            <text fg={Colors.ui.text}>AUTO, AGENT, PLANNER, PLAN-PRD, DEBUG. Data is sent only to Z.ai's API.</text>
            <box height={1} />
            <text fg={Colors.ui.dim}>{SEPARATOR}</text>
            <box height={1} />

            {/* Help links */}
            <text fg={Colors.ui.dim}>Use /help for quick reference | See CONTRIBUTING.md to help out</text>
            <box height={1} />

            {/* Creator info at bottom */}
            <box flexDirection="row">
              <text fg={Colors.ui.dim}>Created by Spencer Francisco (@spencer_i_am) | </text>
              <text fg={Colors.status.warning}>BETA</text>
            </box>
            <text fg={Colors.ui.dim}>Note: The creator is not affiliated with Z.ai</text>
          </box>
        </scrollbox>

        {/* Fixed footer */}
        <box flexShrink={0} height={2} justifyContent="center" paddingTop={1}>
          <text fg={Colors.ui.dim}>Press Enter or Esc to close</text>
        </box>
      </box>
    </box>
  );
}
