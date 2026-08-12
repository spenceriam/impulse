import { CURSOR_MARKER, type Component } from "@mariozechner/pi-tui";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import packageJson from "../../package.json";
import { A, clr } from "./ansi-theme.js";
import { wrapGutterLines } from "./gutter.js";
import { renderSlashAutocompleteLines } from "./slash-autocomplete.js";
import { buildTopLevelSlashCommandList } from "./slash-commands.js";
import {
  createSkillActionOverlay,
  createSkillsListOverlay,
} from "./skills-presentation.js";
import { AllowAllDisclaimerOverlay } from "./components/allow-all-disclaimer-overlay.js";
import { ContextBarComponent } from "./components/context-bar.js";
import { HelpOverlay } from "./components/help-overlay.js";
import { MarkdownTextBlock } from "./components/markdown-text.js";
import { PermissionOverlay } from "./components/permission-overlay.js";
import { PlanApprovalOverlay } from "./components/plan-approval-overlay.js";
import { QuestionOverlay } from "./components/question-overlay.js";
import { ExecutionHandoffOverlay } from "./components/execution-handoff-overlay.js";
import { PreviewReviewOverlay } from "./components/preview-review-overlay.js";
import { SettingsOverlay } from "./components/settings-overlay.js";
import { ThinkingBlock } from "./components/thinking-block.js";
import { ToolBlock } from "./components/tool-block.js";
import type { InstalledSkillMeta } from "../tools/install-skill-source.js";
import type { PresentationDensity } from "./presentation-density.js";

export const CAPTURE_WIDTHS = [60, 80, 120] as const;

export const UX_CAPTURE_ARTIFACT_FILES = {
  html: "impulse-ux-capture.html",
  ansi: "impulse-ux-capture.ansi",
  plain: "impulse-ux-capture.txt",
} as const;

export type CaptureWidth = (typeof CAPTURE_WIDTHS)[number];

export interface UxCaptureScenario {
  id: string;
  title: string;
  render: (terminalWidth: number) => string[];
}

export interface RenderedUxCaptureScenario {
  id: string;
  title: string;
  lines: string[];
}

export interface RenderedUxCaptureWidth {
  width: number;
  scenarios: RenderedUxCaptureScenario[];
}

type SizeAwareComponent = Component & {
  preferredBoxWidth?: (terminalWidth: number) => number;
  setMeasureTerminalWidth?: (terminalWidth: number) => void;
};

function renderComponent(component: Component, terminalWidth: number): string[] {
  return component.render(terminalWidth);
}

function renderContentSizedOverlay(
  component: SizeAwareComponent,
  terminalWidth: number
): string[] {
  component.setMeasureTerminalWidth?.(terminalWidth);
  const boxWidth = component.preferredBoxWidth?.(terminalWidth) ?? terminalWidth;
  return component.render(boxWidth);
}

function densityGap(density: PresentationDensity): string[] {
  return density === "comfy" ? [""] : [];
}

function renderConversation(width: number, density: PresentationDensity): string[] {
  const markdown = new MarkdownTextBlock("    ");
  markdown.setText([
    "The deterministic capture is ready for visual review.",
    "",
    "| Surface | State | Evidence |",
    "| --- | --- | --- |",
    "| Markdown | final | table rendered |",
    "| Context | fixed | no provider needed |",
    "",
    "Content after the table remains visible and wraps through the production Markdown renderer.",
    "- list after the table",
    "```ts",
    "const capture = true;",
    "```",
    "",
    "| Follow-up | Result |",
    "| --- | --- |",
    "| second table | independent layout |",
  ].join("\n"));

  return [
    ...wrapGutterLines(clr.user("you"), width),
    ...wrapGutterLines(
      "Capture the current terminal UX at the required widths and keep the evidence deterministic.",
      width
    ),
    ...densityGap(density),
    ...wrapGutterLines(A.fg(33, "impulse") + A.reset, width),
    ...renderComponent(markdown, width),
  ];
}

function renderThinking(width: number, density: PresentationDensity): string[] {
  const streaming = new ThinkingBlock();
  streaming.setText(
    "Comparing the narrow and wide layouts while preserving the bilateral gutter."
  );

  const finalized = new ThinkingBlock();
  finalized.setText("The fixed scenario has enough evidence for the visual critic.");
  finalized.finalize(2400);

  return [
    ...renderComponent(streaming, width),
    ...densityGap(density),
    ...renderComponent(finalized, width),
  ];
}

function renderTools(width: number, density: PresentationDensity): string[] {
  const toolOptions = { presentationDensity: density } as const;
  const read = new ToolBlock("file_read", { path: "src/cli/renderer.ts" }, toolOptions);
  read.setDone(
    {
      success: true,
      output: "renderer source",
      metadata: {
        type: "file_read",
        filePath: "src/cli/renderer.ts",
        linesRead: 120,
        truncated: false,
      },
    },
    140,
    { compact: true }
  );

  const edit = new ToolBlock("file_edit", {
    path: "src/cli/ux-capture.ts",
    old_string: "before",
    new_string: "after",
  }, toolOptions);
  edit.setDone(
    {
      success: true,
      output: "Applied edit",
      metadata: {
        type: "file_edit",
        filePath: "src/cli/ux-capture.ts",
        diff: "",
        compactDiff: [
          "41 -const mode = 'interactive';",
          "41 +const mode = 'capture';",
        ],
        linesAdded: 1,
        linesRemoved: 1,
        replacements: 1,
      },
    },
    320
  );

  const bash = new ToolBlock("bash", {
    command: "bun test test/ux-capture.test.ts",
  }, toolOptions);
  bash.setDone({ success: true, output: "12 pass\n0 fail" }, 860, {
    compact: true,
  });

  const task = new ToolBlock(
    "task",
    { description: "Inspect terminal layout invariants" },
    { subagentCodename: "SCOUT", presentationDensity: density }
  );
  task.setDone(
    {
      success: true,
      output: "Inspection complete",
      metadata: {
        type: "task",
        subagentType: "explore",
        description: "Inspect terminal layout invariants",
        actions: [
          { label: "read renderer components", durationMs: 180 },
          { label: "checked width invariants", durationMs: 240 },
        ],
        toolCallCount: 2,
      },
    },
    1120
  );

  return [read, edit, bash, task].flatMap((component, index) => [
    ...(index === 0 ? [] : densityGap(density)),
    ...renderComponent(component, width),
  ]);
}

function renderThinkingTools(width: number, density: PresentationDensity): string[] {
  return [
    ...renderThinking(width, density),
    ...densityGap(density),
    ...renderTools(width, density),
  ];
}

function renderPermission(width: number): string[] {
  return renderContentSizedOverlay(
    new PermissionOverlay({
      id: "capture-permission",
      sessionID: "capture-session",
      permission: "bash",
      patterns: ["bun test test/ux-capture.test.ts"],
      message: "Execute the targeted UX capture tests",
      metadata: {
        command: "bun test test/ux-capture.test.ts",
        reason: "Verify deterministic terminal rendering at every required width",
        executionBoundary: "HOST",
        approvalPolicy: "PROMPT",
      },
    }),
    width
  );
}

function renderAllowAllDisclaimer(width: number): string[] {
  return renderComponent(new AllowAllDisclaimerOverlay(), width);
}

function renderQuestion(width: number): string[] {
  const overlay = new QuestionOverlay({
    context: "Choose how the capture should present dense terminal evidence.",
    questions: [
      {
        topic: "Density",
        question: "Which presentation density should the Gauntlet use?",
        options: [
          { label: "Balanced", description: "Keep context without crowding the terminal." },
          { label: "Compact", description: "Prioritize more evidence per screen." },
          { label: "Spacious", description: "Favor separation between rendered states." },
        ],
      },
    ],
  });
  overlay.setMaxHeight(20);
  return renderContentSizedOverlay(overlay, width);
}

function renderExecutionHandoff(width: number): string[] {
  return renderComponent(new ExecutionHandoffOverlay({
    request: "Implement the requested project changes.",
    description: "ASK needs direct user authority before consequential execution.",
  }), width);
}

function renderPreviewReview(width: number): string[] {
  return renderComponent(new PreviewReviewOverlay({
    changedFiles: ["src/execution/boundary.ts", "test/safe-preview.test.ts"],
    diffStat: "2 files changed, 48 insertions(+), 3 deletions(-)",
    agentSummary: ["Focused preview tests passed", "Active worktree remains unchanged"],
  }), width);
}

function renderHelp(width: number): string[] {
  const overlay = new HelpOverlay({
    opts: {
      experimentalAdvisor: false,
      experimentalUndo: false,
      experimentalGoal: false,
    },
    maxHeight: 28,
  });
  return renderContentSizedOverlay(overlay, width);
}

function renderSlashAutocomplete(width: number): string[] {
  const commands = buildTopLevelSlashCommandList({
    experimentalAdvisor: false,
    experimentalUndo: false,
    experimentalGoal: false,
  });
  return renderSlashAutocompleteLines("/sk", commands, width);
}

function renderSkillsDiscovery(width: number, density: PresentationDensity): string[] {
  const skills: InstalledSkillMeta[] = [
    {
      slug: "grill-with-docs",
      name: "Grill with docs",
      description: "Sharpen a plan through a focused documented interview",
      command: "grill",
      path: "/capture/.agents/skills/grill-with-docs/SKILL.md",
    },
    {
      slug: "release-check",
      name: "Release check",
      description: "Verify release readiness and required evidence",
      path: "/capture/.agents/skills/release-check/SKILL.md",
    },
  ];
  const list = createSkillsListOverlay(skills, 18, "AGENT", density);
  const actions = createSkillActionOverlay(skills[0]!, 18, "AGENT", density);

  return [
    ...renderContentSizedOverlay(list, width),
    ...densityGap(density),
    ...renderContentSizedOverlay(actions, width),
  ];
}

function renderPlanReview(width: number, density: PresentationDensity): string[] {
  return renderComponent(
    new PlanApprovalOverlay({
      planPath: ".impulse/plans/capture/plan.md",
      summary: "Add a credential-free renderer harness and verify fixed-width output.",
      planMarkdown: [
        "# Capture plan",
        "1. Render current components at 60, 80, and 120 columns.",
        "2. Emit HTML, ANSI, and plain-text evidence.",
        "3. Assert labels and line widths.",
      ].join("\n"),
      presentationDensity: density,
    }),
    width
  );
}

function renderSettings(width: number, density: PresentationDensity): string[] {
  const overlay = new SettingsOverlay({
    values: {
      presentationDensity: density,
      approvalPolicy: "prompt",
      thinkingDisplay: "summary",
      reasoningLevel: "medium",
      responsePreference: "concise",
      statsOnExit: true,
      showSubagentThinking: true,
      useSubagentModel: true,
      workerModel: "openai/gpt-5",
      subagentModel: "openai/gpt-5-mini",
      visionModelOverride: "openai/gpt-5-mini",
      compactToolOutput: true,
      bottomBarVisual: "full",
    },
  });
  overlay.setMaxHeight(24);
  return renderContentSizedOverlay(overlay, width);
}

function renderPlanSettings(width: number, density: PresentationDensity): string[] {
  return [
    ...renderPlanReview(width, density),
    ...densityGap(density),
    ...renderSettings(width, density),
  ];
}

function renderContextBar(width: number, mode: "ASK" | "AGENT"): string[] {
  const component = new ContextBarComponent(
    {
      workerModel: "openai/gpt-5",
      impulseVersion: (packageJson as { version: string }).version,
      advisorModel: "openrouter/claude-sonnet",
      contextTokens: 68_000,
      contextWindow: 200_000,
      mode,
      reasoningLevel: "medium",
      cwd: "/workspace/impulse",
      tokensPerSecond: 42,
      lastTurnMs: 3800,
      showTurnSpeed: true,
      queueDepth: 2,
      goalLabel: "Gauntlet capture",
      bottomBarVisual: "full",
      presentationDensity: "compact",
      executionBoundary: "HOST",
      approvalPolicy: "PROMPT",
    },
    {
      now: () => new Date("2026-08-10T12:00:00.000Z"),
      branch: () => "gauntlet/capture",
    }
  );
  return renderComponent(component, width);
}

export const UX_CAPTURE_SCENARIOS: readonly UxCaptureScenario[] = [
  { id: "conversation-compact", title: "Compact user prompt and assistant Markdown", render: (width) => renderConversation(width, "compact") },
  { id: "conversation-comfy", title: "Comfy user prompt and assistant Markdown", render: (width) => renderConversation(width, "comfy") },
  { id: "thinking-tools-compact", title: "Compact thinking and tool lifecycle", render: (width) => renderThinkingTools(width, "compact") },
  { id: "thinking-tools-comfy", title: "Comfy thinking and tool lifecycle", render: (width) => renderThinkingTools(width, "comfy") },
  { id: "permission", title: "Permission overlay", render: renderPermission },
  { id: "allow-all-disclaimer", title: "Allow-all disclaimer", render: renderAllowAllDisclaimer },
  { id: "question", title: "Question overlay", render: renderQuestion },
  { id: "execution-handoff", title: "ASK execution handoff", render: renderExecutionHandoff },
  { id: "preview-review", title: "Isolated preview review", render: renderPreviewReview },
  { id: "help", title: "Slash command help", render: renderHelp },
  { id: "slash-autocomplete", title: "Slash autocomplete", render: renderSlashAutocomplete },
  { id: "skills-compact", title: "Compact skills discovery and actions", render: (width) => renderSkillsDiscovery(width, "compact") },
  { id: "skills-comfy", title: "Comfy skills discovery and actions", render: (width) => renderSkillsDiscovery(width, "comfy") },
  { id: "plan-settings-compact", title: "Compact plan review and settings", render: (width) => renderPlanSettings(width, "compact") },
  { id: "plan-settings-comfy", title: "Comfy plan review and settings", render: (width) => renderPlanSettings(width, "comfy") },
  { id: "context-bar-ask", title: "Context bar · ASK authority", render: (width) => renderContextBar(width, "ASK") },
  { id: "context-bar-agent", title: "Context bar · AGENT authority", render: (width) => renderContextBar(width, "AGENT") },
];

export function renderUxCapture(
  widths: readonly number[] = CAPTURE_WIDTHS
): RenderedUxCaptureWidth[] {
  return widths.map((width) => ({
    width,
    scenarios: UX_CAPTURE_SCENARIOS.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      lines: scenario.render(width),
    })),
  }));
}

export interface SerializedUxCaptureArtifacts {
  html: string;
  ansi: string;
  plain: string;
}

const CSI_SEQUENCE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const SGR_SEQUENCE = /\x1b\[([0-9;]*)m/g;

export function stripTerminalControlSequences(text: string): string {
  return text.split(CURSOR_MARKER).join("").replace(CSI_SEQUENCE, "");
}

function evidenceLines(capture: readonly RenderedUxCaptureWidth[]): string[] {
  const lines = [
    "# impulse deterministic UX capture",
    `# widths=${capture.map((entry) => entry.width).join(",")}`,
  ];

  for (const entry of capture) {
    lines.push("", `@@ width=${entry.width}`);
    for (const scenario of entry.scenarios) {
      lines.push(`@@ scenario=${scenario.id} title=${scenario.title}`);
      for (const line of scenario.lines) {
        lines.push(line.includes("\x1b[") ? `${line}\x1b[0m` : line);
      }
      lines.push(`@@ end=${scenario.id}`);
    }
    lines.push(`@@ end-width=${entry.width}`);
  }

  return lines;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type AnsiStyle = {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  strike: boolean;
  foreground?: number;
  background?: number;
};

function ansi256Color(index: number): string {
  const basic = [
    "#0b0c0e", "#ff6b6b", "#6fca6f", "#e6c655",
    "#5c8fff", "#b48eff", "#5cffff", "#d7d7d7",
    "#666666", "#ff8787", "#87df87", "#ffe06b",
    "#79a5ff", "#c9a8ff", "#7dffff", "#ffffff",
  ];
  if (index >= 0 && index < basic.length) return basic[index]!;
  if (index >= 16 && index <= 231) {
    const value = index - 16;
    const levels = [0, 95, 135, 175, 215, 255];
    const red = levels[Math.floor(value / 36)] ?? 0;
    const green = levels[Math.floor((value % 36) / 6)] ?? 0;
    const blue = levels[value % 6] ?? 0;
    return `rgb(${red} ${green} ${blue})`;
  }
  if (index >= 232 && index <= 255) {
    const level = 8 + (index - 232) * 10;
    return `rgb(${level} ${level} ${level})`;
  }
  return "#f2f2f2";
}

function styleCss(style: AnsiStyle): string {
  const rules: string[] = [];
  if (style.bold) rules.push("font-weight:700");
  if (style.dim) rules.push("opacity:.62");
  if (style.italic) rules.push("font-style:italic");
  if (style.strike) rules.push("text-decoration:line-through");
  if (style.foreground !== undefined) {
    rules.push(`color:${ansi256Color(style.foreground)}`);
  }
  if (style.background !== undefined) {
    rules.push(`background:${ansi256Color(style.background)}`);
  }
  return rules.join(";");
}

function resetAnsiStyle(style: AnsiStyle): void {
  style.bold = false;
  style.dim = false;
  style.italic = false;
  style.strike = false;
  delete style.foreground;
  delete style.background;
}

function applySgrCodes(style: AnsiStyle, rawCodes: string): void {
  const codes = rawCodes.length === 0
    ? [0]
    : rawCodes.split(";").map((value) => Number.parseInt(value, 10));

  for (let index = 0; index < codes.length; index++) {
    const code = codes[index] ?? 0;
    if (code === 0) resetAnsiStyle(style);
    else if (code === 1) style.bold = true;
    else if (code === 2) style.dim = true;
    else if (code === 3) style.italic = true;
    else if (code === 9) style.strike = true;
    else if (code === 22) {
      style.bold = false;
      style.dim = false;
    } else if (code === 23) style.italic = false;
    else if (code === 29) style.strike = false;
    else if (code >= 30 && code <= 37) style.foreground = code - 30;
    else if (code >= 90 && code <= 97) style.foreground = code - 90 + 8;
    else if (code === 39) delete style.foreground;
    else if (code >= 40 && code <= 47) style.background = code - 40;
    else if (code >= 100 && code <= 107) style.background = code - 100 + 8;
    else if (code === 49) delete style.background;
    else if ((code === 38 || code === 48) && codes[index + 1] === 5) {
      const color = codes[index + 2];
      if (color !== undefined && Number.isFinite(color)) {
        if (code === 38) style.foreground = color;
        else style.background = color;
      }
      index += 2;
    }
  }
}

function ansiLineToHtml(line: string): string {
  const source = line.split(CURSOR_MARKER).join("");
  const style: AnsiStyle = {
    bold: false,
    dim: false,
    italic: false,
    strike: false,
  };
  const parts: string[] = [];
  let offset = 0;

  for (const match of source.matchAll(SGR_SEQUENCE)) {
    const index = match.index;
    if (index > offset) {
      const text = escapeHtml(source.slice(offset, index).replace(CSI_SEQUENCE, ""));
      const css = styleCss(style);
      parts.push(css ? `<span style="${css}">${text}</span>` : text);
    }
    applySgrCodes(style, match[1] ?? "");
    offset = index + match[0].length;
  }

  if (offset < source.length) {
    const text = escapeHtml(source.slice(offset).replace(CSI_SEQUENCE, ""));
    const css = styleCss(style);
    parts.push(css ? `<span style="${css}">${text}</span>` : text);
  }

  return parts.join("");
}

function renderCaptureHtml(capture: readonly RenderedUxCaptureWidth[]): string {
  const widthSections = capture.map((entry) => {
    const scenarios = entry.scenarios.map((scenario) => {
      const body = scenario.lines.map(ansiLineToHtml).join("\n");
      return [
        `<article class="scenario" data-scenario="${escapeHtml(scenario.id)}">`,
        `<h3>${escapeHtml(scenario.title)}</h3>`,
        `<pre class="terminal" style="--terminal-columns:${entry.width}">${body}</pre>`,
        "</article>",
      ].join("\n");
    }).join("\n");

    return [
      `<section class="width" data-terminal-columns="${entry.width}">`,
      `<h2>${entry.width} columns</h2>`,
      scenarios,
      "</section>",
    ].join("\n");
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Impulse deterministic UX capture</title>
<style>
  :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #090a0c; color: #f2f2f2; }
  header { position: sticky; top: 0; z-index: 2; padding: 20px 28px; background: #090a0cee; border-bottom: 1px solid #292c31; backdrop-filter: blur(10px); }
  h1, h2, h3, p { margin: 0; }
  h1 { font-size: 18px; letter-spacing: .01em; }
  header p { margin-top: 6px; color: #8f949d; font-size: 13px; }
  main { display: grid; gap: 30px; padding: 28px; }
  .width { display: grid; gap: 14px; min-width: 0; }
  .width > h2 { color: #5cffff; font: 700 14px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .scenario { min-width: 0; padding: 14px; border: 1px solid #292c31; border-radius: 8px; background: #101216; overflow: auto; }
  .scenario h3 { margin-bottom: 10px; color: #a5aab3; font: 600 12px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; text-transform: uppercase; letter-spacing: .06em; }
  .terminal { width: calc(var(--terminal-columns) * 1ch); min-width: calc(var(--terminal-columns) * 1ch); margin: 0; padding: 12px 0; color: #f2f2f2; background: #0b0c0e; font: 13px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; tab-size: 2; overflow: visible; }
</style>
</head>
<body>
<header>
  <h1>Impulse deterministic UX capture</h1>
  <p>Credential-free production render evidence at fixed terminal widths.</p>
</header>
<main>
${widthSections}
</main>
</body>
</html>
`;
}

export function serializeUxCaptureArtifacts(
  capture: readonly RenderedUxCaptureWidth[] = renderUxCapture()
): SerializedUxCaptureArtifacts {
  const ansi = `${evidenceLines(capture).join("\n")}\n`;
  return {
    html: renderCaptureHtml(capture),
    ansi,
    plain: stripTerminalControlSequences(ansi),
  };
}

export function writeUxCaptureArtifacts(
  outputDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../docs/gauntlet/artifacts"
  )
): string[] {
  const artifacts = serializeUxCaptureArtifacts();
  fs.mkdirSync(outputDir, { recursive: true });

  const writes = [
    [UX_CAPTURE_ARTIFACT_FILES.html, artifacts.html],
    [UX_CAPTURE_ARTIFACT_FILES.ansi, artifacts.ansi],
    [UX_CAPTURE_ARTIFACT_FILES.plain, artifacts.plain],
  ] as const;

  return writes.map(([filename, content]) => {
    const artifactPath = path.join(outputDir, filename);
    fs.writeFileSync(artifactPath, content, "utf8");
    return artifactPath;
  });
}

if (import.meta.main) {
  for (const artifactPath of writeUxCaptureArtifacts()) {
    process.stdout.write(`${artifactPath}\n`);
  }
}
