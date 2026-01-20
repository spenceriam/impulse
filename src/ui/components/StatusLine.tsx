import { ProgressBar } from "./ProgressBar";

/**
 * Status Line Component
 * Bottom status bar with comprehensive information display
 */

export function StatusLine() {
  const model = "GLM-4.7";
  const mode = "AUTO";
  const progress = 0;
  const dir = "~/glm-cli";
  const branch = "main";
  const mcpStatus = "4/4";
  const date = "01-20-2026";

  return (
    <box border height={1} padding={1}>
      <text>
        <span>{model}</span>
        <span> │ </span>
        <span>{mode}</span>
        <span> │ </span>
        <ProgressBar percent={progress} width={8} />
        <span> │ </span>
        <span>{dir}</span>
        <span> │ </span>
        <span>{branch}</span>
        <span> │ MCPs: </span>
        <span>{mcpStatus}</span>
        <span> │ </span>
        <span>{date}</span>
      </text>
    </box>
  );
}
