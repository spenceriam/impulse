import { useKeyboard } from "@opentui/solid";
import { Colors } from "../design";

/**
 * StartOverlay Component
 * Welcome screen shown on first launch, accessible via /start command
 * 
 * Soft, friendly introduction to IMPULSE with key info about the tool.
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
        title="Welcome to IMPULSE"
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
            <text fg={Colors.ui.text}>Welcome! IMPULSE is a terminal-based AI coding agent with a brutally</text>
            <text fg={Colors.ui.text}>minimal UI. It provides flicker-free streaming, tool execution, and</text>
            <text fg={Colors.ui.text}>session management for developers who prefer working in the terminal.</text>
            <box height={1} />
            <text fg={Colors.ui.dim}>{SEPARATOR}</text>
            <box height={1} />

            {/* MCP servers section */}
            <text fg={Colors.ui.text}>Powered by Z.ai's Coding Plan - the best cost/engineering ratio for</text>
            <text fg={Colors.ui.text}>builders. Integrated MCP servers:</text>
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
            <text fg={Colors.ui.text}>Built for developers who want a focused terminal harness with integrated</text>
            <text fg={Colors.ui.text}>MCP tools. Run from any working directory - sessions are stored per-</text>
            <text fg={Colors.ui.text}>directory so you can return to previous conversations.</text>
            <box height={1} />
            <text fg={Colors.ui.text}>Built on OpenTUI with tool calling. Supports 5 modes: AUTO, AGENT,</text>
            <text fg={Colors.ui.text}>PLANNER, PLAN-PRD, DEBUG.</text>
            <box height={1} />
            <text fg={Colors.ui.dim}>{SEPARATOR}</text>
            <box height={1} />

            {/* Help links */}
            <text fg={Colors.ui.dim}>Use /help for quick reference | See CONTRIBUTING.md to help out</text>
          </box>
        </scrollbox>

        {/* Fixed footer with creator info and controls */}
        <box flexShrink={0} height={4} flexDirection="column" borderColor={Colors.ui.dim} border={["top"]}>
          <box height={1} />
          <box justifyContent="center">
            <text fg={Colors.ui.dim}>Created by Spencer Francisco (</text>
            <text fg={Colors.mode.AGENT}>@spencer_i_am</text>
            <text fg={Colors.ui.dim}>) | </text>
            <text fg={Colors.status.warning}>BETA</text>
          </box>
          <box justifyContent="center">
            <text fg={Colors.ui.dim}>Enter/Esc: close</text>
          </box>
        </box>
      </box>
    </box>
  );
}
