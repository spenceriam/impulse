/**
 * ImpulseRenderer — full TUI using @mariozechner/pi-tui
 *
 * Layout (top → bottom, viewport shows bottom when content overflows):
 *   chatContainer     — conversation history (grows upward as turns add content)
 *   loaderLine        — Braille spinner while agent works (Loader component)
 *   ── separator ──   — always visible divider
 *   contextBar        — model │ tokens │ dir ⎇ branch │ mode │ stats
 *   promptInput       — [MODE] › _   (Input component, Tab cycles modes)
 *
 * Sticky bar: pi-tui renders all children top→bottom and shows the last N
 * lines when content exceeds terminal height, so the bar is always visible.
 */

import {
  TUI,
  ProcessTerminal,
  Container,
  Text,
  Spacer,
  truncateToWidth,
  wrapTextWithAnsi,
  type Component,
  type Focusable,
  type OverlayHandle,
} from "@mariozechner/pi-tui";
import { Editor, type EditorTheme } from "@mariozechner/pi-tui";
import { GUTTER, gutterSeparator } from "./gutter.js";
import { setModelAutocomplete } from "./model-setup.js";
import { ContextBarComponent } from "./components/context-bar.js";
import { BottomAnchorSpacer } from "./components/bottom-anchor-spacer.js";
import { ToolBlock } from "./components/tool-block.js";
import { MarkdownTextBlock } from "./components/markdown-text.js";
import { PermissionOverlay } from "./components/permission-overlay.js";
import { QuestionOverlay } from "./components/question-overlay.js";
import { AgentLoop, type LoopEvents } from "../agent/loop.js";
import { load as loadConfig, save as saveConfig, type Config, type ReasoningLevel } from "../util/config.js";
import {
  PROVIDER_REASONING_STYLE,
  getLevelsForStyle,
  cycleReasoningLevel,
  formatReasoningLevelForDisplay,
  discoverOllamaReasoning,
  discoverOllamaMaxOutputTokens,
  type ReasoningCapability,
} from "../api/providers/capabilities.js";
import { resetProviderManager } from "../api/manager.js";
import {
  MODEL_PROVIDERS,
  discoverModels,
  maskKey,
  maskKeyFull,
  modelWithProviderPrefix,
  parseProviderChoice,
  providerConfig,
  saveHomeEnv,
  type ModelDiscoveryResult,
  type ModelProviderOption,
  type StoredProviderConfig,
} from "./model-setup.js";
import { Bus } from "../bus/index.js";
import { QuestionEvents } from "../bus/events.js";
import { PermissionEvents, respond, type PermissionRequest } from "../permission/index.js";
import { SessionManager } from "../session/manager.js";
import { abortCurrentBashExecution } from "../tools/bash.js";
import { rejectQuestion, resolveQuestion, type Question } from "../tools/question.js";
import { setCurrentMode } from "../tools/mode-state.js";
import { normalizeMode } from "../constants.js";
import type { Mode } from "../constants.js";
import packageJson from "../../package.json";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ── Debug logging ────────────────────────────────────────────────────────────
const debugLogPath = path.join(os.homedir(), ".config", "impulse", "debug.log");
let debugEnabled = false;

function debugLog(msg: string): void {
  if (!debugEnabled) return;
  const timestamp = new Date().toISOString();
  const sessionID = SessionManager.getCurrentSessionID() ?? "no-session";
  fs.appendFileSync(debugLogPath, `[${timestamp}] [${sessionID}] ${msg}\n`);
}

function setDebugEnabled(enabled: boolean): void {
  debugEnabled = enabled;
}

function isDebugEnabled(): boolean {
  return debugEnabled;
}

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const A = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  fg:     (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`,
};
const clr = {
  user:    (s: string) => A.fg(36, s),
  success: (s: string) => A.fg(32, s),
  error:   (s: string) => A.fg(31, s),
  warn:    (s: string) => A.fg(33, s),
  dim:     (s: string) => A.fg(90, s),
  bold:    (s: string) => `${A.bold}${s}${A.reset}`,
  tool:    (s: string) => A.fg(36, s),
  advisor: (s: string) => A.fg(35, s),
  mode:    (s: string) => A.fg(34, s),
  sep:     (s: string) => A.fg(90, s),
};

// ANSI color per mode — used for ❯ arrow and context bar mode label
const MODE_COLORS: Record<string, number> = {
  AGENT: 34, EXPLORE: 32, PLAN: 33, DEBUG: 31,
};

const EDITOR_THEME: EditorTheme = {
  borderColor: (s: string) => s,
  selectList: {
    selectedPrefix: (s: string) => s,
    selectedText: (s: string) => s,
    description: (s: string) => s,
    scrollInfo: (s: string) => s,
    noMatch: (s: string) => s,
  },
};

// ── PromptInput: wraps pi-tui Editor, intercepts special keys ─────────────────

export class PromptInput implements Component, Focusable {
  focused = false;

  private editor: Editor;

  constructor(tui?: any) {
    const t = tui || { terminal: { rows: 24, columns: 80 } };
    this.editor = new Editor(t, EDITOR_THEME, { paddingX: 0 });
  }
  private _modeColorCode = 34;
  // Paste state — array supports multiple sequential pastes
  private _pasteGroups: Array<{ display: string; content: string }> = [];
  private _detectedImages: string[] = []; // base64 URIs or file paths
  private _nextImageIndex = 1; // cumulative image counter
  private _isPasting = false;
  private _pasteBuffer = "";
  private _secretMode = false;

  onTabForward?:  () => void;
  onTabBackward?: () => void;
  onAbort?:       () => void;
  onExit?:        () => void;
  onEscape?:      () => void;
  onChange?:      (value: string) => void;
  onArrowUp?:     (() => void) | null;
  onArrowDown?:   (() => void) | null;
  onArrowLeft?:   (() => void) | null;
  onArrowRight?:  (() => void) | null;
  onEnter?:       (() => void) | null;

  setModeColor(code: number): void { this._modeColorCode = code; }
  setSecretMode(enabled: boolean): void { this._secretMode = enabled; }
  getEditor(): Editor { return this.editor; }

  get onSubmit() { return this.editor.onSubmit; }
  set onSubmit(fn: ((v: string) => void) | undefined) {
    if (fn !== undefined) {
      this.editor.onSubmit = () => fn(this._submitCache);
    } else {
      this.editor.onSubmit = undefined as unknown as (value: string) => void;
    }
  }
  private _submitCache = "";

  /** Returns the real value (actual paste content if applicable) */
  getSubmitValue(): string {
    let displayed = this.editor.getText();
    // Editor clears text before onSubmit fires — use cached value if available
    if (displayed.length === 0 && this._submitCache.length > 0) {
      return this._submitCache;
    }
    for (const group of this._pasteGroups) {
      if (displayed.includes(group.display)) {
        displayed = displayed.replace(group.display, group.content);
      }
    }
    return displayed;
  }

  clear(): void {
    this.editor.setText("");
    this._pasteGroups = [];
    this._detectedImages = [];
    this._nextImageIndex = 1;
    this._isPasting = false;
    this._pasteBuffer = "";
    this._submitCache = "";
  }

  /** Returns images detected in the current input */
  getImages(): string[] { return this._detectedImages; }

  private _detectImages(content: string): number {
    let found = 0;

    // Base64 data URIs: data:image/png;base64,iVBOR...
    const base64Regex = /data:image\/(png|jpeg|jpg|gif|webp|bmp);base64,[A-Za-z0-9+/=]+/gi;
    const base64Matches = content.match(base64Regex);
    if (base64Matches) {
      for (const match of base64Matches) {
        if (!this._detectedImages.includes(match)) {
          this._detectedImages.push(match);
          found++;
        }
      }
    }

    // File paths to image files
    const fileRegex = /(\/(?:tmp|home|var|Users)\/[^\s\n]*\.(?:png|jpg|jpeg|gif|webp|bmp))/gi;
    const fileMatches = content.match(fileRegex);
    if (fileMatches) {
      for (const match of fileMatches) {
        if (!this._detectedImages.includes(match)) {
          this._detectedImages.push(match);
          found++;
        }
      }
    }

    return found;
  }

  handleInput(data: string): void {
    if (data.length > 1 && !data.includes("\x1b") && (data.includes("\r") || data.includes("\n"))) {
      for (const char of data) this.handleInput(char);
      return;
    }

    if (data === "\t")     { this.onTabForward?.();  return; }
    if (data === "\x1b[Z") { this.onTabBackward?.(); return; }
    if (data === "\x03")   { this.onAbort?.();        return; }
    if (data === "\x04")   { this.onExit?.();         return; }
    if (data === "\x1b")   { this.onEscape?.();       return; }

    // Arrow key navigation (for model setup)
    if (data === "\x1b[A" && this.onArrowUp)   { this.onArrowUp();   return; }
    if (data === "\x1b[B" && this.onArrowDown) { this.onArrowDown(); return; }
    if (data === "\x1b[D" && this.onArrowLeft) { this.onArrowLeft(); return; }
    if (data === "\x1b[C" && this.onArrowRight){ this.onArrowRight();return; }
    if (data === "\r" && this.onEnter)         { this.onEnter();     return; }

    // Cache expanded paste value before Editor clears it on submit
    if (data === "\r") {
      this._submitCache = this.getSubmitValue();
    }

    // ── Bracketed paste detection ──────────────────────────────────────────
    const hasPasteStart = data.includes("\x1b[200~");
    const hasPasteEnd   = data.includes("\x1b[201~");

    if (hasPasteStart) {
      this._isPasting = true;
      const afterStart = data.slice(data.indexOf("\x1b[200~") + 6);
      const content    = hasPasteEnd
        ? afterStart.slice(0, afterStart.indexOf("\x1b[201~"))
        : afterStart;
      this._pasteBuffer = content;

      if (hasPasteEnd) this._finalizePaste();
      return;
    }

    if (this._isPasting) {
      if (hasPasteEnd) {
        this._pasteBuffer += data.slice(0, data.indexOf("\x1b[201~"));
        this._finalizePaste();
      } else {
        this._pasteBuffer += data;
      }
      return;
    }

    const anyPasteDisplayBeforeInput = this._pasteGroups.length > 0
      ? this._pasteGroups[this._pasteGroups.length - 1]!.display
      : null;

    this.editor.handleInput(data);
    this._submitCache = ""; // reset cache on non-submit input

    // If any visible paste token was edited away, drop that group's hidden payload
    if (anyPasteDisplayBeforeInput !== null && !this.editor.getText().includes(anyPasteDisplayBeforeInput)) {
      this._pasteGroups.pop();
    }

    this.onChange?.(this.editor.getText());
  }

  private _finalizePaste(): void {
    this._isPasting = false;
    const content = this._pasteBuffer;
    this._pasteBuffer = "";

    // Detect images in pasted content before building display label
    const imageCount = this._detectImages(content);

    const lines = content.split("\n").filter((l) => l.length > 0);

    if (imageCount > 0) {
      // Image paste — cumulative user-friendly label
      const startIndex = this._nextImageIndex;
      const endIndex = startIndex + imageCount - 1;
      const label = imageCount === 1
        ? `[Pasted image #${startIndex}]`
        : `[Pasted images #${startIndex}-#${endIndex}]`;
      this._nextImageIndex += imageCount;
      this._pasteGroups.push({ display: label, content });
      this.editor.handleInput(label);
    } else if (lines.length > 1) {
      const display = `[Pasted ${lines.length} lines  ${content.length} chars]`;
      this._pasteGroups.push({ display, content });
      this.editor.handleInput(display);
    } else if (content.length > 120) {
      const display = `[Pasted ${content.length} chars]`;
      this._pasteGroups.push({ display, content });
      this.editor.handleInput(display);
    } else {
      // Short paste — insert normally
      this.editor.handleInput("\x1b[200~" + content + "\x1b[201~");
    }
  }

  invalidate(): void { this.editor.invalidate(); }

  render(width: number): string[] {
    // pi-tui Input renders its own "> " prefix; replace it with the mode-colored arrow.
    const editorWidth = Math.max(1, width - 5);
    const rawLines = this.editor.render(editorWidth);
    const innerLines = (rawLines.length > 2 ? rawLines.slice(1, -1) : rawLines)
      .map((l) => l.replace(/_pi:c/g, ""));
    const firstLine = innerLines[0] ?? "";
    const content = firstLine.startsWith("> ") ? firstLine.slice(2) : firstLine;
    const ARROW = `${GUTTER}\x1b[${this._modeColorCode}m\u276f\x1b[0m `;

    if (this._secretMode) {
      const valueLength = this.editor.getText().length;
      const masked = valueLength > 0 ? "*".repeat(Math.min(valueLength, Math.max(0, width - 4))) : "";
      return [truncateToWidth(ARROW + masked, width)];
    }

    return [
      truncateToWidth(ARROW + content, width, ""),
      ...innerLines.slice(1).map((line) => truncateToWidth(GUTTER + line, width, "")),
    ];
  }
}

// ── SeparatorLine: a fixed dim horizontal rule ────────────────────────────────

class SeparatorLine implements Component {
  invalidate() {}
  render(width: number): string[] {
    return [A.dim + gutterSeparator(width) + A.reset];
  }
}

class ThinkingBlock implements Component {
  private raw = "";

  setText(text: string): void {
    this.raw = text;
  }

  render(width: number): string[] {
    const prefix = GUTTER;
    const label = "Thinking:";
    const firstPrefix = `${prefix}\x1b[38;5;94m${label}\x1b[0m `;
    const continuationPrefix = " ".repeat(prefix.length + label.length + 1);
    const firstWidth = Math.max(8, width - (prefix.length + label.length + 1));
    const continuationWidth = Math.max(8, width - continuationPrefix.length);
    const textStyle = "\x1b[38;5;238m\x1b[3m";
    const reset = "\x1b[0m";

    const lines: string[] = [];
    let isFirstOutputLine = true;

    for (const paragraph of this.raw.replace(/\r\n/g, "\n").split("\n")) {
      if (paragraph.length === 0) {
        lines.push(continuationPrefix);
        isFirstOutputLine = false;
        continue;
      }

      const available = isFirstOutputLine ? firstWidth : continuationWidth;
      const wrapped = wrapTextWithAnsi(paragraph, available);

      for (const part of wrapped) {
        const linePrefix = isFirstOutputLine ? firstPrefix : continuationPrefix;
        lines.push(truncateToWidth(`${linePrefix}${textStyle}${part}${reset}`, width));
        isFirstOutputLine = false;
      }
    }

    return lines.length > 0 ? lines : [truncateToWidth(firstPrefix, width)];
  }

  invalidate() {}
}

type ModelSetupStep = "provider" | "baseUrl" | "apiKey" | "discovering" | "model" | "reasoning";

interface ProviderEntry {
  provider: ModelProviderOption;
  configured: boolean;
  valid: boolean;  // API key validation result
  keyPreview: string;  // Masked key preview
}

interface ModelSetupState {
  step: ModelSetupStep;
  config: Config;
  currentProvider: string;
  provider?: ModelProviderOption;
  existing?: StoredProviderConfig;
  baseUrl?: string;
  apiKey?: string;
  models: string[];
  discovery?: ModelDiscoveryResult;
  isAdvisorMode?: boolean;  // true when picking advisor model vs switching provider
  selectedModel?: string;   // Model selected in "model" step, used in reasoning step
  error?: string;
  // Navigation state
  providers: ProviderEntry[];  // Configured providers first, then unconfigured
  selectedIndex: number;       // Currently selected provider/model index
  page: number;                // Current page for model list
  modelsPerPage: number;       // Models per page (default: 20)
}

// ── ImpulseRenderer ───────────────────────────────────────────────────────────

export class ImpulseRenderer {
  // pi-tui objects
  private terminal = new ProcessTerminal();
  private tui!: TUI;

  // Tools that should not render output to the user
  private static readonly SILENT_TOOLS = new Set(["set_header"]);

  // Layout components
  private chat!: Container;
  private spinnerText!: Text;
  private contextBar!: ContextBarComponent;
  private promptInput!: PromptInput;
  private autocompleteText!: Text; // slash command suggestions
  private modelSetupText!: Text;
  private bottomSpacer!: BottomAnchorSpacer;

  // Manual turn-status spinner + render ticker
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private currentStatusPhrase = "";
  private statusPhraseIndex = 0;
  private static readonly STATUS_PHRASES = [
    "...i'm on it...",
    "...handling that now...",
    "...let me look into that...",
    "...let's see what we have here...",
    "...digging into it now...",
    "...let's break this down...",
    "...parsing that now...",
    "...let's get a clear read on this...",
    "...reading the prompt...",
    "...checking the request...",
    "...analyzing the context...",
    "...reviewing the files...",
    "...looking at the workspace...",
    "...let me review this...",
    "...checking the details...",
    "...scanning the input...",
    "...thinking this through...",
    "...mapping it out...",
    "...sorting through the request...",
    "...putting the pieces together...",
    "...getting a handle on this...",
    "...let's run the numbers...",
    "...running the calculations...",
    "...evaluating the options...",
    "...formulating a response...",
    "...putting a thought together...",
    "...working on an answer...",
    "...let me map this out...",
    "...let's take a look...",
    "...inspecting the request...",
    "...reading the lines...",
    "...gathering the context...",
    "...breaking down the steps...",
    "...organizing the response...",
    "...processing the input...",
    "...checking the structure...",
    "...lining things up...",
    "...focusing on this...",
    "...getting a clear picture...",
    "...working the problem...",
    "...holding for the model...",
    "...awaiting response...",
    "...processing feedback...",
    "...interpreting....",
  ];

  /** Pick a phrase index from STATUS_PHRASES based on the current action */
  private pickPhraseIndex(msg: string): number {
    const normalized = msg.toLowerCase();
    if (normalized.includes("think")) return 16;             // "...thinking this through..."
    if (normalized.includes("respond")) return 25;            // "...putting a thought together..."
    if (normalized.includes("bash") || normalized.includes("shell")) return 22; // "...running the calculations..."
    if (normalized.includes("question") || normalized.includes("approval")) return 41; // "...awaiting response..."
    if (normalized.includes("waiting")) return 40;            // "...holding for the model..."
    if (normalized.includes("compact")) return 33;            // "...organizing the response..."
    if (normalized.includes("todo")) return 5;                // "...let's break this down..."
    if (normalized.includes("consult")) return 1;             // "...handling that now..."
    // Fallback: pick a random phrase so the same action shows variety
    const available = ImpulseRenderer.STATUS_PHRASES.filter((_, i) => i !== this.statusPhraseIndex);
    return available.length > 0
      ? ImpulseRenderer.STATUS_PHRASES.indexOf(available[Math.floor(Math.random() * available.length)]!)
      : Math.floor(Math.random() * ImpulseRenderer.STATUS_PHRASES.length);
  }

  private shimmerBusyText(message: string): string {
    const chars = Array.from(message);
    if (chars.length === 0) return "";

    // Head advances every 80ms (2x faster than previous 180ms)
    const head = Math.floor(Date.now() / 80) % chars.length;
    return chars.map((char, index) => {
      if (/\s/.test(char)) return char;
      const distance = Math.min(Math.abs(index - head), chars.length - Math.abs(index - head));
      // Neutral grayscale tones — no cyan/white — Cursor/Claude Code style
      if (distance === 0) return A.fg(248, `${A.bold}${char}${A.reset}`);
      if (distance === 1) return A.fg(244, char);
      return A.fg(234, char);
    }).join("");
  }

  private renderBusyLine(): void {
    if (!this.currentStatusPhrase) {
      this.spinnerText.setText("");
      return;
    }
    this.spinnerText.setText(`${GUTTER}${this.shimmerBusyText(this.currentStatusPhrase)}`);
  }

  private spinStop(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    this.currentStatusPhrase = "";
    this.spinnerText.setText("");
    this.tui.requestRender();
  }

  /** Check if advisor mode should be turned off (all tasks complete) */
  private async checkAutoOffSuggestion(): Promise<void> {
    const config = await loadConfig();
    if (!config.advisorMode || !this.tui) return;

    // Check if todos are all complete
    const session = SessionManager.getCurrentSession();
    if (!session?.messages) return;

    // Look for todo_write completions in recent tool calls
    let allTodosComplete = false;
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const msg = session.messages[i]!;
      if (msg.role === "assistant" && msg.content && typeof msg.content === "string" && msg.content.includes("- [") && msg.content.includes("- [x]")) {
        // Check if all items are completed
        const items = msg.content.match(/- \[([ x])\]/g);
        if (items && items.every(it => it.includes("[x]"))) {
          allTodosComplete = true;
          break;
        }
      }
    }

    if (!allTodosComplete) return;

    // Show auto-off overlay
    const lines = [
      `${clr.bold("Strategy Complete")}`,
      `${clr.dim("─".repeat(40))}`,
      `All tasks from the advisor plan are complete.`,
      `The main agent suggests advisor mode is no longer needed.`,
      "",
      `${clr.dim("Enter: Keep ON  |  D: Deactivate Advisor  |  Esc: Dismiss")}`,
    ];

    const overlayContent: Component = {
      invalidate() {},
      render(_width: number): string[] { return lines; },
    };

    type AutoOffDecision = "keep" | "deactivate" | "dismiss";
    const result = await new Promise<AutoOffDecision>((resolve) => {
      const handle = this.tui.showOverlay(overlayContent, {
        anchor: "center",
        width: "80%",
        minWidth: 50,
        maxHeight: 8,
        margin: { left: 2, right: 2, bottom: 4 },
      });
      handle.focus();

      const cleanup = this.tui.addInputListener((data: string) => {
        if (data === "\r") {
          cleanup();
          handle.hide();
          resolve("keep");
          return { consume: true };
        }
        if (data === "d" || data === "D") {
          cleanup();
          handle.hide();
          resolve("deactivate");
          return { consume: true };
        }
        if (data === "\x1b") {
          cleanup();
          handle.hide();
          resolve("dismiss");
          return { consume: true };
        }
        return undefined;
      });
    });

    if (result === "deactivate") {
      config.advisorMode = false;
      await saveConfig(config);
      this.addChatLine(`${clr.success("✓")} Advisor mode disabled — all tasks complete`);
      this.tui.requestRender();
    }
  }

  private setBusyStatus(msg: string): void {
    if (this.spinnerInterval && this.currentStatusPhrase && msg === "thinking…") {
      // Don't re-set the phrase during continuous thinking/streaming
      return;
    }

    this.statusPhraseIndex = this.pickPhraseIndex(msg);
    this.currentStatusPhrase = ImpulseRenderer.STATUS_PHRASES[this.statusPhraseIndex] ?? "working…";
    this.renderBusyLine();
    this.tui.requestRender();

    if (!this.spinnerInterval) {
      this.spinnerInterval = setInterval(() => {
        this.renderBusyLine();
        this.tui.requestRender();
      }, 80);
    }
  }

  private enqueuePermissionRequest(request: PermissionRequest): void {
    if (this.activePermission?.id === request.id || this.permissionQueue.some((item) => item.id === request.id)) {
      return;
    }

    this.permissionQueue.push(request);
    this.showNextPermissionOverlay();
  }

  private showNextPermissionOverlay(): void {
    if (!this.tui || this.activePermission || this.permissionQueue.length === 0) {
      return;
    }

    const request = this.permissionQueue.shift()!;
    this.activePermission = request;
    this.setBusyStatus("waiting for your approval…");

    const overlay = new PermissionOverlay(request);
    overlay.onDecision = (response) => {
      const permissionID = request.id;
      const resumeStatus = `running ${request.permission}…`;
      this.dismissPermissionOverlay(resumeStatus);
      respond({ permissionID, response });
    };

    this.permissionOverlayHandle = this.tui.showOverlay(overlay, {
      anchor: "bottom-center",
      offsetY: -4,
      width: "92%",
      minWidth: 60,
      maxHeight: 10,
      margin: { left: 2, right: 2, bottom: 4 },
    });
    this.permissionOverlayHandle.focus();
    this.tui.requestRender();
  }

  private dismissPermissionOverlay(resumeStatus?: string): void {
    this.permissionOverlayHandle?.hide();
    this.permissionOverlayHandle = null;
    this.activePermission = null;

    if (this.permissionQueue.length > 0) {
      this.showNextPermissionOverlay();
      return;
    }

    if (resumeStatus && this.isRunning) {
      this.setBusyStatus(resumeStatus);
    }

    this.tui.setFocus(this.promptInput);
    this.tui.requestRender();
  }

  private showQuestionOverlay(context: string | undefined, questions: Question[]): void {
    if (!this.tui) return;

    this.dismissQuestionOverlay(false);
    this.setBusyStatus("waiting for your answer…");

    const overlay = new QuestionOverlay({ context, questions });
    overlay.onSubmit = (answers) => {
      this.dismissQuestionOverlay(false);
      resolveQuestion(answers);
      if (this.isRunning) {
        this.setBusyStatus("responding…");
      }
    };
    overlay.onAbort = () => {
      this.abortCurrentTurn();
    };

    this.questionOverlayHandle = this.tui.showOverlay(overlay, {
      anchor: "bottom-center",
      offsetY: -4,
      width: "92%",
      minWidth: 70,
      maxHeight: 18,
      margin: { left: 2, right: 2, bottom: 4 },
    });
    this.questionOverlayHandle.focus();
    this.tui.requestRender();
  }

  private dismissQuestionOverlay(restoreFocus = true): void {
    this.questionOverlayHandle?.hide();
    this.questionOverlayHandle = null;
    if (restoreFocus) {
      this.tui.setFocus(this.promptInput);
    }
    this.tui.requestRender();
  }

  private abortCurrentTurn(): void {
    if (!this.isRunning) return;

    rejectQuestion(new Error("Question cancelled by user"));
    this.dismissQuestionOverlay(false);
    abortCurrentBashExecution();
    this.loop.abort();
    this.spinStop();
    this.isRunning = false;
    this.contextBar.update({ isRunning: false });
    this.addChatLine(`  ${clr.warn("⊘")}  ${clr.dim("aborted")}`);
    this.tui.setFocus(this.promptInput);
    this.tui.requestRender();
  }

  // Streaming state: current assistant text block (updated in-place)
  private streamingText: MarkdownTextBlock | null = null;
  private streamingRaw = "";
  private thinkingText: ThinkingBlock | null = null;
  private thinkingRaw = "";
  private thinkingOpen = false;
  private hasTrailingGap = false;
  private toolBlocks = new Map<string, ToolBlock>();
  private permissionQueue: PermissionRequest[] = [];
  private activePermission: PermissionRequest | null = null;
  private permissionOverlayHandle: OverlayHandle | null = null;
  private questionOverlayHandle: OverlayHandle | null = null;
  private busUnsubscribe: (() => void) | null = null;
  private liveTurnStartedAt = 0;
  private liveGeneratedChars = 0;
  private lastLiveMetricsAt = 0;

  // Agent + state
  private loop = new AgentLoop();
  private mode: Mode = "AGENT";
  private contextTokens = 0;
  private contextWindow = 200000;
  private advisorModel: string | undefined;
  private reasoningLevel: ReasoningLevel = "medium";
  private reasoningCapability: ReasoningCapability = { supported: true, style: "binary", levels: ["off", "medium"] };
  private isRunning = false;
  private modelSetup: ModelSetupState | null = null;
  private pendingPlanApproval: { planPath: string; summary: string } | null = null;
  private userName = "you"; // User's display name (loaded from config)
  private modeChangeText: Text | null = null; // Track mode change line for in-place updates

  async start(): Promise<void> {
    const config = await loadConfig();
    this.mode = normalizeMode(config.defaultMode) as Mode;
    this.advisorModel = config.advisorModel;
    this.reasoningLevel = config.reasoningLevel ?? (config.thinking ? "medium" : "off");
    this.reasoningCapability = this.reasoningCapabilityForProvider(config.defaultProvider);
    this.userName = config.userProfile?.name || "you";
    await this.normalizeReasoningLevel();

    setCurrentMode(this.mode);

    if (!SessionManager.getCurrentSession()) {
      await SessionManager.createNew();
    }

    this.contextWindow = SessionManager.getCurrentSession()?.context_window ?? this.contextWindow;
    this.contextTokens = this.estimateCurrentSessionTokens();

    // Debug logging
    debugLog(`Session started`);
    debugLog(`thinking: ${config.thinking}, reasoningLevel: ${config.reasoningLevel}`);
    debugLog(`provider: ${config.defaultProvider}, model: ${config.defaultModel}`);

    // ── Build TUI layout ──────────────────────────────────────────────────
    this.tui = new TUI(this.terminal);

    this.busUnsubscribe?.();
    this.busUnsubscribe = Bus.subscribe((event) => {
      if (event.type === PermissionEvents.Asked.name) {
        this.enqueuePermissionRequest(event.properties as PermissionRequest);
        return;
      }

      if (event.type === QuestionEvents.Asked.name) {
        const payload = event.properties as { context?: string; questions: Question[] };
        this.showQuestionOverlay(payload.context, payload.questions);
      }
    });

    // 0. Bottom anchor spacer — pushes content down so contextBar stays at terminal bottom
    this.bottomSpacer = new BottomAnchorSpacer(this.tui, () => this.getContentHeight());
    this.tui.addChild(this.bottomSpacer);

    // 1. Chat history — grows as turns are added
    this.chat = new Container();
    this.tui.addChild(this.chat);

    // Welcome header
    this.chat.addChild(new Spacer(1));
    this.chat.addChild(new Text(
      `${GUTTER}${clr.bold("IMPULSE")} ${A.dim}|${A.reset} cli coding agent ${A.dim}|${A.reset} ${A.fg(90, "v" + (packageJson as {version:string}).version)}`,
      0, 0
    ));
    this.chat.addChild(new Text(
      `${GUTTER}${A.fg(90, "Tab: agent mode  |  Shift+Tab: reasoning  |  /help: commands  |  Esc/Ctrl+C: abort  |  Ctrl+D: exit")}`,
      0, 0
    ));
    this.chat.addChild(new Spacer(1));

    // 2. Spacer + turn-status line above the prompt
    this.tui.addChild(new Spacer(1));
    this.spinnerText = new Text("", 0, 0);
    this.tui.addChild(this.spinnerText);

    // 3. Separator ABOVE input
    this.tui.addChild(new SeparatorLine());

    this.modelSetupText = new Text("", 0, 0);
    this.tui.addChild(this.modelSetupText);

    // Slash command autocomplete — shown only when input starts with /
    this.autocompleteText = new Text("", 0, 0);
    this.tui.addChild(this.autocompleteText);

    // 4. Prompt input (just › , no mode label)
    this.promptInput = new PromptInput(this.tui);
    this.promptInput.onSubmit = (value) => {
      this.promptInput.clear();
      this.autocompleteText.setText("");
      if (this.modelSetup) void this.handleModelSetupSubmit(value);
      else void this.onSubmit(value);
    };
    this.promptInput.onTabForward  = () => { if (!this.modelSetup) this.cycleMode(1); };
    this.promptInput.onTabBackward = () => { if (!this.modelSetup) void this.cycleReasoning(); };
    this.promptInput.onAbort = () => {
      if (this.modelSetup) {
        this.cancelModelSetup();
        return;
      }
      if (this.isRunning) {
        this.abortCurrentTurn();
      } else {
        // Ctrl+C while idle = exit with stats
        this.showExitStats();
        this.tui.stop();
        process.exit(0);
      }
    };
    this.promptInput.onExit = () => { this.showExitStats(); this.tui.stop(); process.exit(0); };
    this.promptInput.onEscape = () => {
      if (this.modelSetup) {
        const state = this.modelSetup;
        // Go back to previous step, or cancel if at first step
        if (state.step === "model" || state.step === "discovering") {
          state.step = "provider";
          delete state.error;
          this.setupModelNavigation();
          this.renderModelSetup();
        } else if (state.step === "apiKey" || state.step === "baseUrl") {
          state.step = "provider";
          delete state.error;
          this.setupModelNavigation();
          this.renderModelSetup();
        } else {
          this.cancelModelSetup();
        }
        return;
      }

      if (this.isRunning) {
        this.abortCurrentTurn();
      }
    };
    this.promptInput.onChange = (val) => this.updateAutocomplete(val);
    this.tui.addChild(this.promptInput);

    // 5. Separator BELOW input
    this.tui.addChild(new SeparatorLine());

    // 6. Context bar — sticky absolute bottom
    this.contextBar = new ContextBarComponent({
      workerModel: config.defaultModel,
      contextTokens: this.contextTokens,
      contextWindow: this.contextWindow,
      mode: this.mode,
      reasoningLevel: this.reasoningDisplayLabel(),
      ...(this.advisorModel ? { advisorModel: this.advisorModel } : {}),
    });
    this.tui.addChild(this.contextBar);

    // ── Start TUI (takes over terminal raw mode) ──────────────────────────
    this.syncModeColor(); // set initial arrow color
    this.tui.setFocus(this.promptInput);
    this.tui.start();
    // Discover reasoning capabilities in background (non-blocking)
    void this.refreshReasoningCapability();
  }

  // ── Mode cycling ─────────────────────────────────────────────────────────

  private cycleMode(dir: 1 | -1): void {
    if (this.isRunning) return;
    const modes: Mode[] = ["AGENT", "EXPLORE", "PLAN", "DEBUG"];
    const prev = this.mode;
    const idx = modes.indexOf(this.mode);
    this.mode = modes[((idx + dir) + modes.length) % modes.length]!;
    setCurrentMode(this.mode);
    this.contextBar.update({ mode: this.mode });
    this.syncModeColor();

    const modeLine = `${GUTTER}${A.fg(MODE_COLORS[prev] ?? 34, prev)} → ${A.fg(MODE_COLORS[this.mode] ?? 34, this.mode)}`;
    if (this.modeChangeText) {
      // Update existing mode change line in place
      this.modeChangeText.setText(modeLine);
    } else {
      // Create new mode change line
      this.addChatLine("");  // Empty line before mode change
      this.modeChangeText = new Text(modeLine, 0, 0);
      this.chat.addChild(this.modeChangeText);
    }
    this.tui.requestRender();
  }

  private syncModeColor(): void {
    this.promptInput.setModeColor(MODE_COLORS[this.mode] ?? 34);
  }

  /** Cycle reasoning level using provider capability (Shift+Tab) */
  private async cycleReasoning(): Promise<void> {
    if (this.isRunning) return;
    if (!this.reasoningCapability.supported) return; // Do nothing if model doesn't support reasoning
    const next = cycleReasoningLevel(this.reasoningLevel, this.reasoningCapability);
    await this.setReasoningLevel(next);
  }

  /** Refresh reasoning capabilities for the current model */
  private async refreshReasoningCapability(): Promise<void> {
    try {
      const config = await loadConfig();
      const providerName = config.defaultProvider;
      // For Ollama, query /api/show to check if this specific model supports thinking
      if (providerName === "ollama") {
        const modelName = (config.defaultModel ?? "").replace(/^ollama\//, "");
        const baseUrl = config.providers?.ollama?.baseUrl ?? "https://ollama.com";
        const apiKey  = config.providers?.ollama?.apiKey;
        this.reasoningCapability = await discoverOllamaReasoning(baseUrl, modelName, apiKey);

        const explicitMaxOutput = await discoverOllamaMaxOutputTokens(baseUrl, modelName, apiKey);
        if (explicitMaxOutput !== undefined && explicitMaxOutput !== config.maxOutputTokens) {
          config.maxOutputTokens = explicitMaxOutput;
          await saveConfig(config);
        }
      } else {
        this.reasoningCapability = this.reasoningCapabilityForProvider(providerName);
      }
      await this.normalizeReasoningLevel();
      this.contextBar.update({ reasoningLevel: this.reasoningDisplayLabel() });
      this.tui.requestRender();
    } catch {
      // Keep default binary capability if discovery fails
    }
  }

  private reasoningCapabilityForProvider(providerName: string): ReasoningCapability {
    const style = PROVIDER_REASONING_STYLE[providerName] ?? "none";
    return {
      supported: style !== "none",
      style,
      levels: getLevelsForStyle(style),
    };
  }

  private reasoningLevels(): ReasoningLevel[] {
    return this.reasoningCapability.supported ? this.reasoningCapability.levels : ["off"];
  }

  private reasoningDisplayLabel(level: ReasoningLevel = this.reasoningLevel): string {
    return formatReasoningLevelForDisplay(level, this.reasoningCapability);
  }

  private reasoningLevelsLabel(): string {
    return this.reasoningLevels()
      .map((level) => this.reasoningDisplayLabel(level))
      .join(" | ");
  }

  private parseReasoningLevel(input: string): ReasoningLevel | null {
    const normalized = input.toLowerCase().trim();
    if (normalized === "thinking" || normalized === "think" || normalized === "on") {
      return this.reasoningCapability.style === "binary" ? "medium" : null;
    }
    if (normalized === "off" || normalized === "low" || normalized === "medium" || normalized === "high") {
      return normalized;
    }
    return null;
  }

  private async normalizeReasoningLevel(): Promise<void> {
    const levels = this.reasoningLevels();
    if (levels.includes(this.reasoningLevel)) return;

    const next: ReasoningLevel =
      this.reasoningLevel === "off"
        ? "off"
        : levels.includes("medium")
          ? "medium"
          : levels[0] ?? "off";

    this.reasoningLevel = next;
    const config = await loadConfig();
    config.reasoningLevel = next;
    config.thinking = next !== "off";
    await saveConfig(config);
  }

  private async setReasoningLevel(level: ReasoningLevel): Promise<void> {
    this.reasoningLevel = level;
    const config = await loadConfig();
    config.reasoningLevel = level;
    config.thinking = level !== "off";
    await saveConfig(config);
    this.contextBar.update({ reasoningLevel: this.reasoningDisplayLabel(level) });
    this.tui.requestRender();
  }

  private estimateCurrentSessionTokens(): number {
    const session = SessionManager.getCurrentSession();
    if (!session) return 0;
    if (!session.messages || session.messages.length === 0) return 0;
    return Math.ceil(JSON.stringify(session.messages).length / 4);
  }

  private resetLiveMetrics(): void {
    this.liveTurnStartedAt = Date.now();
    this.liveGeneratedChars = 0;
    this.lastLiveMetricsAt = 0;
  }

  private updateLiveMetrics(extraContextChars = 0, force = false): void {
    const now = Date.now();
    if (!force && now - this.lastLiveMetricsAt < 250) return;

    this.lastLiveMetricsAt = now;
    const liveChars = this.streamingRaw.length + this.thinkingRaw.length + extraContextChars;
    const localContextTokens = this.estimateCurrentSessionTokens() + Math.ceil(liveChars / 4);
    const generatedTokens = Math.ceil(this.liveGeneratedChars / 4);
    const elapsedMs = Math.max(1, now - this.liveTurnStartedAt);
    const tokensPerSecond = generatedTokens > 0 ? Math.round((generatedTokens / elapsedMs) * 1000) : undefined;

    this.contextTokens = localContextTokens;
    this.contextBar.update({
      contextTokens: localContextTokens,
      contextWindow: this.contextWindow,
      isRunning: this.isRunning,
      ...(tokensPerSecond !== undefined ? { tokensPerSecond } : {}),
    });
  }

  private noteLiveGeneration(text: string): void {
    this.liveGeneratedChars += text.length;
    this.updateLiveMetrics();
  }

  private toolBusyStatus(name: string): string {
    switch (name) {
      case "question":
        return "waiting for your answer…";
      case "todo_write":
        return "updating todos…";
      case "todo_read":
        return "reading todos…";
      case "task":
        return "running subagent…";
      default:
        return `running ${name}…`;
    }
  }

  // ── Input submission ──────────────────────────────────────────────────────

  private async onSubmit(value: string): Promise<void> {
    const input = value.trim();
    if (!input) return;

    if (input.startsWith("/")) {
      await this.handleSlash(input);
      this.tui.requestRender();
      return;
    }

    const images = this.promptInput.getImages();
    await this.runTurn(input, images);
  }

  // ── Agent turn ────────────────────────────────────────────────────────────

  private async runTurn(userMessage: string, images: string[] = []): Promise<void> {
    // Mid-turn config validation: advisor mode ON but config missing?
    const config = await loadConfig();
    if (config.advisorMode && !config.advisorModel) {
      this.addChatLine(`${clr.warn("!")} Advisor Mode is ON but no advisor model is configured.`);
      this.addChatLine(`${clr.dim("Use /advisor to reconfigure or /advisor off to disable.")}`);
      this.tui.requestRender();
      return;
    }
    if (config.advisorMode && config.advisorModel) {
      const providerKey = config.advisorModel.split("/")[0] ?? config.defaultProvider;
      const stored = providerConfig(config, providerKey);
      if (!stored?.apiKey) {
        this.addChatLine(`${clr.warn("!")} Advisor provider (${providerKey}) has no API key. Use /advisor to reconfigure.`);
        this.tui.requestRender();
        return;
      }
    }
    this.isRunning = true;
    this.modeChangeText = null; // Reset mode change tracking for new turn

    // User message block
    this.addSectionGap();
    this.addChatLine(`${A.fg(36, this.userName)}`);
    this.addChatLine(`${userMessage}`);
    this.addSectionGap();

    this.streamingRaw = "";
    this.streamingText = null;
    this.thinkingRaw = "";
    this.thinkingText = null;
    this.thinkingOpen = false;
    this.resetLiveMetrics();
    this.loop.setImages(images);
    this.contextBar.update({
      isRunning: true,
      mode: this.mode,
      contextTokens: this.contextTokens,
      contextWindow: this.contextWindow,
    });

    const events: LoopEvents = {
      onTurnStart: () => {
        this.contextTokens = this.estimateCurrentSessionTokens();
        this.contextBar.update({
          contextTokens: this.contextTokens,
          contextWindow: this.contextWindow,
          mode: this.mode,
          isRunning: true,
        });
        this.updateLiveMetrics(0, true);
        this.setBusyStatus("thinking…");
      },
      onToken: (text) => {
        this.setBusyStatus("responding…");
        this.closeThinking();
        if (!this.streamingText) {
          // Add Impulse response header on first token
          this.addSectionGap();
          this.chat.addChild(new Text(`${GUTTER}${A.fg(33, "Impulse")}${A.reset}`, 0, 0));
          this.hasTrailingGap = false;
          this.streamingText = new MarkdownTextBlock(GUTTER);
          this.chat.addChild(this.streamingText);
          this.hasTrailingGap = false;
        }
        this.streamingRaw += text;
        this.streamingText.setText(this.streamingRaw);
        this.noteLiveGeneration(text);
        this.tui.requestRender();
      },
      onThinking: (text) => {
        this.setBusyStatus("thinking…");
        debugLog(`onThinking: ${text.length} chars`);
        if (!this.thinkingOpen) {
          this.thinkingRaw = "";
          this.thinkingText = null;
        }
        if (!this.thinkingText) {
          debugLog(`Thinking block started`);
          this.addSectionGap();
          this.thinkingText = new ThinkingBlock();
          this.chat.addChild(this.thinkingText);
          this.hasTrailingGap = false;
          this.thinkingOpen = true;
        }
        this.thinkingRaw += text;
        this.thinkingText.setText(this.thinkingRaw);
        this.noteLiveGeneration(text);
        this.tui.requestRender();
      },
      onAdvisorStart: (model) => {
        const short = model.split("/").pop() ?? model;
        this.setBusyStatus(`consulting ${short}…`);
        this.addChatLine(`${clr.dim(`[advisor • consulting ${short}…]`)}`);
        this.tui.requestRender();
      },
      onAdvisorToken: (_text) => { /* buffered */ },
      onAdvisorEnd: (summary) => {
        const raw = summary.trim();
        const oneliner = raw.split(/[.!?\n]/)[0]?.trim() ?? raw;
        const truncated = oneliner.length > 80 ? oneliner.slice(0, 77) + "…" : oneliner;
        // Replace last chat line with summary
        this.addChatLine(`${clr.dim(`[advisor: ${truncated}]`)}`);
        this.tui.requestRender();
      },
      onToolStart: (id, name, args) => {
        // Skip rendering for silent tools (e.g., set_header)
        if (ImpulseRenderer.SILENT_TOOLS.has(name)) return;

        this.closeThinking();
        if (this.streamingRaw) { this.addSectionGap(); this.streamingRaw = ""; this.streamingText = null; }
        this.addSectionGap();

        const block = new ToolBlock(name, args);
        this.toolBlocks.set(id, block);
        this.chat.addChild(block);
        this.hasTrailingGap = false;

        this.setBusyStatus(this.toolBusyStatus(name));
        this.updateLiveMetrics(0, true);
        this.tui.requestRender();
      },
      onToolEnd: (id, name, result, durationMs) => {
        // Skip rendering for silent tools (e.g., set_header)
        if (ImpulseRenderer.SILENT_TOOLS.has(name)) return;

        const block = this.toolBlocks.get(id);
        if (block) {
          block.setDone(result, durationMs);
          this.toolBlocks.delete(id);
        }
        if (!this.isRunning) {
          this.tui.requestRender();
          return;
        }

        // Detect advisor plan for approval overlay
        if (name === "consult_advisor" && result.success) {
          try {
            const parsed = JSON.parse(result.output) as { plan_path?: string; summary?: string };
            if (parsed.plan_path && parsed.summary) {
              this.pendingPlanApproval = { planPath: parsed.plan_path, summary: parsed.summary };
            }
          } catch { /* not JSON, skip */ }
        }
        this.setBusyStatus(name === "question" ? "responding…" : "waiting for model…");
        this.updateLiveMetrics(result.output.length, true);
        this.tui.requestRender();
      },
      onCompacting: () => {
        this.addChatLine(`${clr.warn("⟳")}  ${clr.dim("compacting context…")}`);
        this.setBusyStatus("compacting context…");
        this.tui.requestRender();
      },
      onCompacted: (removedCount) => {
        this.addChatLine(`${clr.success("✓")}  ${clr.dim(`compacted — removed ${removedCount} messages`)}`);
        this.setBusyStatus("thinking…");
        this.tui.requestRender();
      },
      onTurnEnd: (usage) => {
        this.spinStop();
        this.dismissQuestionOverlay(false);
        this.closeThinking();
        if (this.streamingRaw) { this.addSectionGap(); }
        this.streamingRaw = ""; this.streamingText = null;
        this.thinkingRaw = "";  this.thinkingText = null;

        this.contextTokens = usage.inputTokens;
        this.contextBar.update({
          contextTokens: usage.inputTokens,
          contextWindow: this.contextWindow,
          mode: this.mode,
          isRunning: false,
          ...(usage.tokensPerSecond > 0 ? { tokensPerSecond: usage.tokensPerSecond } : {}),
          lastTurnMs: usage.durationMs,
        });

        this.addSectionGap();
        this.isRunning = false;
        this.tui.setFocus(this.promptInput);
        this.tui.requestRender();
      },
      onError: (err) => {
        this.spinStop();
        this.dismissQuestionOverlay(false);
        this.contextBar.update({ isRunning: false });
        this.addChatLine(`${clr.error("Error:")} ${err.message}`);
        this.isRunning = false;
        this.tui.setFocus(this.promptInput);
        this.tui.requestRender();
      },
    };

    await this.loop.run(userMessage, this.mode, events);

    // Show plan approval overlay if advisor was consulted
    if (this.pendingPlanApproval) {
      await this.showPlanApprovalOverlay();
      this.pendingPlanApproval = null;
    }

    // Auto-off suggestion: all todos complete + advisor mode ON
    await this.checkAutoOffSuggestion();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private addChatLine(text: string): void {
    this.chat.addChild(new Text(GUTTER + text, 0, 0));
    this.hasTrailingGap = false;
  }

  private addSectionGap(): void {
    if (this.hasTrailingGap) return;
    this.chat.addChild(new Spacer(1));
    this.hasTrailingGap = true;
  }

  /** Show approval overlay after advisor produces a plan */
  private async showPlanApprovalOverlay(): Promise<void> {
    if (!this.tui || !this.pendingPlanApproval) return;

    const { planPath, summary } = this.pendingPlanApproval;
    const shortPath = planPath.replace(new RegExp(`^${os.homedir()}`), "~");

    // Build a simple approval component
    const lines = [
      `${clr.bold("Plan Ready")}`,
      `${clr.dim("─".repeat(40))}`,
      `${clr.dim("Path:")} ${shortPath}`,
      `${clr.dim("Summary:")} ${summary.slice(0, 120)}`,
      "",
      `${clr.dim("Press Enter to proceed, Esc to decline")}`,
    ];

    const overlayContent: Component = {
      invalidate() {},
      render(_width: number): string[] { return lines; },
    };

    type PlanDecision = "proceed" | "decline";
    const result = await new Promise<PlanDecision>((resolve) => {
      const handle = this.tui.showOverlay(overlayContent, {
        anchor: "center",
        width: "80%",
        minWidth: 50,
        maxHeight: 8,
        margin: { left: 2, right: 2, bottom: 4 },
      });
      handle.focus();

      const cleanup = this.tui.addInputListener((data: string) => {
        if (data === "\r") {
          cleanup();
          handle.hide();
          resolve("proceed");
          return { consume: true };
        }
        if (data === "\x1b") {
          cleanup();
          handle.hide();
          resolve("decline");
          return { consume: true };
        }
        return undefined;
      });
    });

    if (result === "proceed") {
      this.addChatLine(`${clr.success("✓")} Plan approved — executing`);
    } else {
      this.addChatLine(`${clr.dim("Plan declined — awaiting new instructions")}`);
    }
    this.tui.requestRender();
  }

  /**
   * Calculate total content height for bottom-anchor positioning.
   * Returns the number of lines occupied by all TUI children except the BottomAnchorSpacer.
   */
  private getContentHeight(): number {
    // Count lines from chat container's children
    let chatLines = 0;
    const width = Math.max(20, this.tui?.terminal?.columns ?? 80);
    for (const child of this.chat.children) {
      if ("render" in child && typeof child.render === "function") {
        // Use the live terminal width so wrapped streaming blocks do not make
        // bottom anchoring jump between estimated and actual row counts.
        const lines = child.render(width);
        chatLines += lines.length;
      }
    }

    // Fixed components (excluding BottomAnchorSpacer and chat):
    // status spacer (1) + spinnerText (1) + SeparatorLine (1) + modelSetupText (1)
    // + autocompleteText (variable) + promptInput (1) + SeparatorLine (1) + contextBar (3)
    let otherLines = 9;

    // Add autocomplete lines if visible
    if (this.autocompleteText) {
      const acLines = this.autocompleteText.render(width);
      otherLines += acLines.length;
    }

    return chatLines + otherLines;
  }

  // ── Slash autocomplete ────────────────────────────────────────────────────

  private slashCommands(): Array<{ cmd: string; hint: string }> {
    return [
      { cmd: "/advisor",  hint: "on | off | <model>  set advisor" },
      { cmd: "/model",    hint: "choose provider, API key, and model" },
      { cmd: "/mode",     hint: "WORK | EXPLORE | PLAN | DEBUG" },
      { cmd: "/reason",   hint: `${this.reasoningLevelsLabel()}  set reasoning level` },
      { cmd: "/new",      hint: "[name]  start new session" },
      { cmd: "/user",     hint: "view/update name, preferences, instructions" },
      { cmd: "/debug",    hint: "toggle debug logging" },
      { cmd: "/help",     hint: "show commands" },
      { cmd: "/clear",    hint: "clear screen" },
      { cmd: "/exit",     hint: "quit" },
      { cmd: "/quit",     hint: "quit" },
    ];
  }

  private updateAutocomplete(val: string): void {
    if (this.modelSetup) {
      this.autocompleteText.setText("");
      this.tui.requestRender();
      return;
    }

    if (!val.startsWith("/") || val.length < 1) {
      this.autocompleteText.setText("");
      this.tui.requestRender();
      return;
    }
    const matches = this.slashCommands().filter((c) =>
      c.cmd.startsWith(val.split(" ")[0]!.toLowerCase())
    );
    if (matches.length === 0) {
      this.autocompleteText.setText("");
    } else {
      const lines = matches
        .map((m) => `  ${A.fg(36, m.cmd)}  ${A.fg(90, m.hint)}`)
        .join("\n");
      this.autocompleteText.setText(lines);
    }
    this.tui.requestRender();
  }

  // ── Exit stats ────────────────────────────────────────────────────────────

  private showExitStats(): void {
    const session = SessionManager.getCurrentSession();
    if (!session) return;
    const msgs    = session.messages.length;
    const turns   = session.messages.filter((m) => m.role === "user").length;
    const created = new Date(session.created_at);
    const now     = new Date();
    const diffMs  = now.getTime() - created.getTime();
    const mins    = Math.floor(diffMs / 60000);
    const dur     = mins < 60 ? `${mins}m` : `${Math.floor(mins/60)}h ${mins%60}m`;
    this.addChatLine("");
    this.addChatLine(`${clr.dim("─".repeat(46))}`);
    this.addChatLine(`${clr.bold("Session summary")}`);
    this.addChatLine(`${clr.dim("session")}   ${session.name}`);
    this.addChatLine(`${clr.dim("duration")}  ${dur}`);
    this.addChatLine(`${clr.dim("turns")}     ${turns}`);
    this.addChatLine(`${clr.dim("messages")}  ${msgs}`);
    this.addChatLine(`${clr.dim("model")}     ${session.model || "(none)"}`);
    this.addChatLine(`${clr.dim("─".repeat(46))}`);
    this.addChatLine("");
    this.tui.requestRender();
  }

  private closeThinking(): void {
    if (this.thinkingOpen && this.thinkingText) {
      debugLog(`Thinking block closed`);
      this.addSectionGap();
      this.thinkingOpen = false;
    }
  }


  /** Read a single raw keypress (used for permission prompts) */
  private readKey(): Promise<string> {
    return new Promise((resolve) => {
      const onData = (data: Buffer | string) => {
        process.stdin.removeListener("data", onData);
        resolve(data.toString().toLowerCase().trim());
      };
      process.stdin.once("data", onData);
    });
  }

  // ── Slash commands ────────────────────────────────────────────────────────

  private async handleSlash(input: string): Promise<void> {
    const parts = input.slice(1).trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase() ?? "";
    const arg = parts.slice(1).join(" ").trim();

    switch (cmd) {
      case "advisor": await this.cmdAdvisor(arg); break;
      case "model":   await this.cmdModel(arg);   break;
      case "mode":    this.cmdMode(arg);           break;
      case "reason":  await this.cmdReason(arg);   break;
      case "user":    await this.cmdUser(arg);     break;
      case "debug":
        setDebugEnabled(!isDebugEnabled());
        this.addChatLine(`${clr.success("✓")} Debug logging ${isDebugEnabled() ? "enabled" : "disabled"}`);
        if (isDebugEnabled()) {
          debugLog(`Debug logging enabled`);
        }
        break;
      case "new":
        await SessionManager.createNew(arg || undefined);
        this.addChatLine(`${clr.success("✓")} New session started`);
        break;
      case "clear":
        // Clear chat history (keep welcome)
        while ((this.chat as Container & { children?: Component[] }).children?.length) {
          break; // can't easily clear — just add a separator
        }
        this.addChatLine(clr.dim("─".repeat(60)));
        break;
      case "help": this.printHelp(); break;
      case "quit":
      case "exit":
        this.showExitStats();
        this.tui.stop();
        process.exit(0);
        break;
      default:
        this.addChatLine(`${clr.warn("?")} Unknown: /${cmd} — try /help`);
    }
  }

  private modelSetupPrompt(): string {
    const state = this.modelSetup;
    if (!state) return "";

    switch (state.step) {
      case "provider":
        return `Provider number/name [${state.currentProvider}]`;
      case "baseUrl":
        return `Endpoint URL [${state.baseUrl ?? state.provider?.modelBaseUrl ?? ""}]`;
      case "apiKey":
        return state.existing?.apiKey
          ? `API key [keep ${maskKey(state.existing.apiKey)}]`
          : "API key";
      case "model": {
        const provider = state.provider;
        const fallback = provider ? this.currentModelForProvider(state.config, provider) : "";
        return `Model number/name [${fallback}]`;
      }
      default:
        return "";
    }
  }

  private renderModelSetup(): void {
    const state = this.modelSetup;
    if (!state) {
      this.modelSetupText.setText("");
      this.promptInput.setSecretMode(false);
      return;
    }

    const lines: string[] = [];

    if (state.step === "provider") {
      lines.push(clr.bold("MODEL SETUP"));
      lines.push(clr.dim("─────────────────────────────────────────────────"));
      lines.push("");

      // Show configured providers first
      const configured = state.providers.filter(p => p.configured);
      const unconfigured = state.providers.filter(p => !p.configured);

      if (configured.length > 0) {
        lines.push(clr.dim("Configured Providers:"));
        for (let i = 0; i < configured.length; i++) {
          const entry = configured[i]!;
          const isSelected = state.selectedIndex === i;
          const prefix = isSelected ? "  > " : "    ";
          const icon = entry.valid ? clr.success("✓") : clr.error("✗");
          const label = isSelected ? A.fg(36, entry.provider.label) : entry.provider.label;
          lines.push(`${prefix}${icon} ${label} ${clr.dim(`(${entry.keyPreview})`)}`);
        }
        lines.push("");
      }

      // Show unconfigured providers
      if (unconfigured.length > 0) {
        lines.push(clr.dim("Add New Provider:"));
        for (let i = 0; i < unconfigured.length; i++) {
          const entry = unconfigured[i]!;
          const idx = configured.length + i;
          const isSelected = state.selectedIndex === idx;
          const prefix = isSelected ? "  > " : "    ";
          const label = isSelected ? A.fg(36, entry.provider.label) : entry.provider.label;
          lines.push(`${prefix}${label}`);
        }
      }

      lines.push("");
      lines.push(clr.dim("↑↓: Navigate  Enter: Select  Esc: Cancel"));
    } else if (state.step === "baseUrl") {
      lines.push(clr.bold("MODEL SETUP"));
      lines.push(clr.dim("─────────────────────────────────────────────────"));
      lines.push("");
      lines.push(`${state.provider?.label ?? "Provider"} endpoint`);
      lines.push("");
      lines.push(clr.dim("Enter a custom endpoint or press Enter to keep the default."));
    } else if (state.step === "apiKey") {
      lines.push(clr.bold("MODEL SETUP"));
      lines.push(clr.dim("─────────────────────────────────────────────────"));
      lines.push("");
      lines.push(`${state.provider?.label ?? "Provider"} API key`);
      lines.push("");
      if (state.existing?.apiKey) {
        const masked = maskKeyFull(state.existing.apiKey);
        lines.push(`Existing key: ${clr.dim(masked)}`);
        lines.push(clr.dim("Press Enter to keep it, or type a replacement."));
      } else {
        lines.push(clr.dim("Type the API key. Input is shown while typing."));
      }
    } else if (state.step === "discovering") {
      const title = state.isAdvisorMode ? "ADVISOR SETUP" : "MODEL SETUP";
      lines.push(clr.bold(title));
      lines.push(clr.dim("─────────────────────────────────────────────────"));
      lines.push("");
      lines.push(`Discovering ${state.provider?.label ?? "provider"} models...`);
      lines.push("");
      lines.push(clr.dim("Testing connection..."));
    } else if (state.step === "model") {
      const title = state.isAdvisorMode ? "ADVISOR SETUP" : "MODEL SETUP";
      lines.push(clr.bold(title));
      lines.push(clr.dim("─────────────────────────────────────────────────"));
      lines.push("");
      if (state.discovery) {
        const marker = state.discovery.success ? clr.success("[OK]") : clr.warn("[WARN]");
        lines.push(`${marker} ${state.discovery.message}`);
      }
      lines.push("");

      // Paginated model list
      const start = state.page * state.modelsPerPage;
      const end = Math.min(start + state.modelsPerPage, state.models.length);
      const pageModels = state.models.slice(start, end);

      for (let i = 0; i < pageModels.length; i++) {
        const globalIdx = start + i;
        const isSelected = globalIdx === state.selectedIndex;
        const prefix = isSelected ? "  > " : "    ";
        const label = isSelected ? A.fg(36, pageModels[i]!) : pageModels[i]!;
        lines.push(`${prefix}${label}`);
      }

      if (state.models.length === 0) {
        lines.push(clr.dim("    No models listed; type a full model ID manually."));
      }

      // Page indicator
      const totalPages = Math.ceil(state.models.length / state.modelsPerPage);
      if (totalPages > 1) {
        lines.push("");
        lines.push(clr.dim(`Page ${state.page + 1}/${totalPages}`));
      }
    } else if (state.step === "reasoning") {
      const title = state.isAdvisorMode ? "ADVISOR SETUP" : "MODEL SETUP";
      lines.push(clr.bold(title));
      lines.push(clr.dim("─────────────────────────────────────────────────"));
      lines.push("");
      lines.push(`${clr.success("[OK]")} ${state.selectedModel ?? ""}`);
      lines.push("");
      lines.push("Select reasoning level:");
      lines.push("");
      const levels = this.reasoningLevels();
      for (let i = 0; i < levels.length; i++) {
        const isSelected = state.selectedIndex === i;
        const label = this.reasoningDisplayLabel(levels[i]!);
        const prefix = isSelected ? "  > " : "    ";
        lines.push(`${prefix}${i + 1}. ${isSelected ? A.fg(36, label) : label}`);
      }
      lines.push("");
      lines.push(clr.dim("↑↓: Navigate  Enter: Select (default: medium)  Esc: back/cancel"));
    }

    if (state.error) {
      lines.push("");
      lines.push(clr.error(state.error));
    }

    if (state.step === "provider") {
      // Arrow navigation mode — no text input needed
      this.promptInput.setSecretMode(false);
    } else {
      // Text input mode
      const prompt = this.modelSetupPrompt();
      if (prompt) {
        lines.push("");
        lines.push(`${prompt}:`);
      }
      lines.push("");
      lines.push(clr.dim("Enter: continue   Esc: back/cancel"));
      this.promptInput.setSecretMode(state.step === "apiKey");
    }

    this.modelSetupText.setText(lines.map(l => GUTTER + l).join("\n"));
    this.tui.requestRender();
  }

  private async selectModelSetupProvider(provider: ModelProviderOption): Promise<void> {
    const state = this.modelSetup;
    if (!state) return;

    const existing = providerConfig(state.config, provider.key);
    state.provider = provider;
    state.existing = existing;
    const baseUrl = existing.baseUrl ?? provider.defaultBaseUrl;
    if (baseUrl) state.baseUrl = baseUrl;
    else delete state.baseUrl;
    delete state.error;

    // If API key already configured, skip to model discovery
    if (existing?.apiKey) {
      state.apiKey = existing.apiKey;
      state.step = "discovering";
      this.renderModelSetup();
      const discovery = await discoverModels(provider, existing.apiKey, state.baseUrl);
      if (!this.modelSetup || this.modelSetup.provider !== provider) return; // cancelled
      state.discovery = discovery;
      state.models = discovery.models;
      if (!discovery.success) {
        state.error = discovery.message;
        state.step = "apiKey";
        this.renderModelSetup();
        return;
      }
      state.step = "model";
      state.page = 0;
      state.selectedIndex = 0;
      setModelAutocomplete(this.promptInput.getEditor(), state.models);
      this.setupModelNavigation();
      this.renderModelSetup();
      return;
    }

    state.step = provider.needsBaseUrl ? "baseUrl" : "apiKey";
  }

  /** Validate API keys for configured providers */
  private async validateProviderKeys(): Promise<void> {
    const state = this.modelSetup;
    if (!state || state.step !== "provider") return;

    for (const entry of state.providers) {
      if (!entry.configured) continue;
      try {
        const stored = providerConfig(state.config, entry.provider.key);
        if (!stored.apiKey) { entry.valid = false; continue; }
        // Simple validation: check if key is non-empty
        // Full validation would require making a test API call
        entry.valid = stored.apiKey.length > 0;
      } catch {
        entry.valid = false;
      }
    }
    this.renderModelSetup();
  }

  private currentModelForProvider(config: Config, provider: ModelProviderOption): string {
    return config.defaultModel?.startsWith(`${provider.key}/`)
      ? config.defaultModel
      : provider.defaultModel;
  }

  private cancelModelSetup(): void {
    if (this.modelSetupInputListener) {
      this.modelSetupInputListener();
      this.modelSetupInputListener = null;
    }
    this.promptInput.getEditor().setAutocompleteProvider(ImpulseRenderer.VOID_AUTOCOMPLETE);
    this.modelSetup = null;
    this.modelSetupText.setText("");
    this.promptInput.setSecretMode(false);
    this.promptInput.clear();
    this.addChatLine(`  ${clr.dim("Model setup cancelled")}`);
    this.tui.requestRender();
  }

  private async handleModelSetupSubmit(value: string): Promise<void> {
    const state = this.modelSetup;
    if (!state) return;

    const input = value.trim();
    if (input.toLowerCase() === "cancel") {
      this.cancelModelSetup();
      return;
    }

    delete state.error;

    if (state.step === "provider") {
      const provider = parseProviderChoice(input, state.currentProvider);
      if (!provider) {
        state.error = "Unknown provider. Enter a number or provider name.";
        this.renderModelSetup();
        return;
      }
      await this.selectModelSetupProvider(provider);
      this.renderModelSetup();
      return;
    }

    if (state.step === "baseUrl") {
      const provider = state.provider;
      if (!provider) return;
      state.baseUrl = input || state.baseUrl || provider.modelBaseUrl;
      state.step = "apiKey";
      this.renderModelSetup();
      return;
    }

    if (state.step === "apiKey") {
      const provider = state.provider;
      if (!provider) return;
      const apiKey = input || state.existing?.apiKey;
      if (!apiKey) {
        state.error = `${provider.label} requires an API key.`;
        this.renderModelSetup();
        return;
      }
      state.apiKey = apiKey;
      state.step = "discovering";
      this.renderModelSetup();
      const discovery = await discoverModels(provider, apiKey, state.baseUrl);
      state.discovery = discovery;
      state.models = discovery.models;
      if (!discovery.success) {
        state.error = discovery.message;
        state.step = "apiKey";
        this.renderModelSetup();
        return;
      }
      state.step = "model";
      state.page = 0;
      state.selectedIndex = 0;
      setModelAutocomplete(this.promptInput.getEditor(), state.models);
      this.setupModelNavigation();
      this.renderModelSetup();
      return;
    }

    if (state.step === "model") {
      // Store selected model and prompt for reasoning level
      const fallbackModel = this.currentModelForProvider(state.config, state.provider!);
      const modelIdx = Number.parseInt(input, 10) - 1;
      if (!input) {
        state.selectedModel = fallbackModel;
      } else if (!Number.isNaN(modelIdx) && state.models[modelIdx]) {
        state.selectedModel = modelWithProviderPrefix(state.provider!.key, state.models[modelIdx]!);
      } else if (!input.match(/^\d+$/)) {
        state.selectedModel = modelWithProviderPrefix(state.provider!.key, input);
      } else {
        state.error = "Invalid model selection.";
        this.renderModelSetup();
        return;
      }
      state.step = "reasoning";
      state.selectedIndex = this.reasoningLevels().indexOf(this.reasoningLevel);
      if (state.selectedIndex < 0) state.selectedIndex = 1; // default to medium
      this.setupModelNavigation();
      this.renderModelSetup();
      return;
    }

    if (state.step === "reasoning") {
      const levels = this.reasoningLevels();
      const idx = Number.parseInt(input, 10) - 1;
      let selectedLevel: ReasoningLevel = "medium";
      if (!input) {
        selectedLevel = "medium";
      } else if (!Number.isNaN(idx) && levels[idx]) {
        selectedLevel = levels[idx]!;
      } else {
        const match = levels.find(l => l && input.toLowerCase() === l);
        if (match) selectedLevel = match;
        else selectedLevel = "medium";
      }
      if (state.selectedModel) {
        await this.finishModelSetup(state.selectedModel, selectedLevel);
      }
    }
  }

  private async finishModelSetup(modelChoice: string, reasoningLevel?: ReasoningLevel): Promise<void> {
    const state = this.modelSetup;
    const provider = state?.provider;
    const apiKey = state?.apiKey;
    if (!state || !provider || !apiKey) return;

    const fallbackModel = this.currentModelForProvider(state.config, provider);
    let selectedModel = fallbackModel;
    const modelIdx = Number.parseInt(modelChoice, 10) - 1;
    if (!modelChoice) {
      selectedModel = fallbackModel;
    } else if (!Number.isNaN(modelIdx) && state.models[modelIdx]) {
      selectedModel = modelWithProviderPrefix(provider.key, state.models[modelIdx]!);
    } else if (!modelChoice.match(/^\d+$/)) {
      selectedModel = modelWithProviderPrefix(provider.key, modelChoice);
    } else {
      state.error = "Invalid model selection.";
      this.renderModelSetup();
      return;
    }

    // Advisor mode: only save advisorModel, don't change default provider/model
    if (state.isAdvisorMode) {
      // Save API key to providers config
      const providers = { ...(state.config.providers as Record<string, StoredProviderConfig | undefined>) };
      providers[provider.key] = {
        ...(state.existing ?? {}),
        apiKey,
        ...(state.baseUrl ? { baseUrl: state.baseUrl } : {}),
      };
      state.config.providers = providers as Config["providers"];
      state.config.advisorModel = selectedModel;
      state.config.advisorMode = true;
      await saveConfig(state.config);
      await saveHomeEnv(provider, apiKey, state.baseUrl);
      this.advisorModel = selectedModel;
      if (reasoningLevel) void this.setReasoningLevel(reasoningLevel);
      this.contextBar.update({ advisorModel: selectedModel, reasoningLevel: this.reasoningDisplayLabel(reasoningLevel) });
      if (this.modelSetupInputListener) {
        this.modelSetupInputListener();
        this.modelSetupInputListener = null;
      }
      this.promptInput.getEditor().setAutocompleteProvider(ImpulseRenderer.VOID_AUTOCOMPLETE);
    this.modelSetup = null;
      this.modelSetupText.setText("");
      this.promptInput.setSecretMode(false);
      this.promptInput.clear();
      this.addChatLine(`${clr.success("✓")} Advisor → ${selectedModel}`);
      this.tui.requestRender();
      return;
    }

    const providers = { ...(state.config.providers as Record<string, StoredProviderConfig | undefined>) };
    providers[provider.key] = {
      ...(state.existing ?? {}),
      apiKey,
      ...(state.baseUrl ? { baseUrl: state.baseUrl } : {}),
    };
    state.config.providers = providers as Config["providers"];
    state.config.defaultProvider = provider.key;
    state.config.defaultModel = selectedModel;
    process.env[provider.envVar] = apiKey;

    await saveConfig(state.config);
    await saveHomeEnv(provider, apiKey, state.baseUrl);
    resetProviderManager();
    SessionManager.setOptions({ defaultModel: selectedModel });
    if (SessionManager.getCurrentSession()) {
      await SessionManager.update({ model: selectedModel });
    }

    this.reasoningCapability = this.reasoningCapabilityForProvider(provider.key);
    await this.normalizeReasoningLevel();
    void this.refreshReasoningCapability();
    // Save reasoning level if provided
    if (reasoningLevel) {
      void this.setReasoningLevel(reasoningLevel);
    }

    this.contextBar.update({
      workerModel: selectedModel,
      reasoningLevel: this.reasoningDisplayLabel(reasoningLevel),
      contextTokens: this.contextTokens,
      contextWindow: this.contextWindow,
      mode: this.mode,
    });

    if (this.modelSetupInputListener) {
      this.modelSetupInputListener();
      this.modelSetupInputListener = null;
    }
    this.promptInput.getEditor().setAutocompleteProvider(ImpulseRenderer.VOID_AUTOCOMPLETE);
    this.modelSetup = null;
    this.modelSetupText.setText("");
    this.promptInput.setSecretMode(false);
    this.promptInput.clear();
    const reasonLabel = reasoningLevel ? ` (${this.reasoningDisplayLabel(reasoningLevel)})` : "";
    this.addChatLine(`${clr.success("✓")} Model changed to: ${selectedModel}${reasonLabel}`);
    this.tui.requestRender();
  }

  private async cmdModel(arg: string): Promise<void> {
    if (this.isRunning) return;

    const config = await loadConfig();
    const currentProvider = config.defaultProvider;

    // Build provider list: configured first, then unconfigured
    const configured: ProviderEntry[] = [];
    const unconfigured: ProviderEntry[] = [];
    for (const provider of MODEL_PROVIDERS) {
      const stored = providerConfig(config, provider.key);
      const hasKey = !!stored.apiKey;
      if (hasKey) {
        configured.push({
          provider,
          configured: true,
          valid: true,  // Will be validated async
          keyPreview: maskKey(stored.apiKey),
        });
      } else {
        unconfigured.push({
          provider,
          configured: false,
          valid: false,
          keyPreview: "",
        });
      }
    }

    this.modelSetup = {
      step: "provider",
      config,
      currentProvider,
      models: [],
      providers: [...configured, ...unconfigured],
      selectedIndex: 0,
      page: 0,
      modelsPerPage: 20,
    };

    const provider = arg ? parseProviderChoice(arg, currentProvider) : null;
    if (arg && !provider) {
      this.modelSetup.error = `Unknown provider: ${arg}`;
    } else if (provider) {
      await this.selectModelSetupProvider(provider);
    }

    this.promptInput.clear();
    this.promptInput.setSecretMode(false);
    this.autocompleteText.setText("");

    // Set up arrow key navigation for provider step
    this.setupModelNavigation();

    this.renderModelSetup();

    // Validate configured providers async
    void this.validateProviderKeys();
  }

  private modelSetupInputListener: (() => void) | null = null;

  /** No-op autocomplete provider to clear model search after setup */
  private static readonly VOID_AUTOCOMPLETE = {
    getSuggestions: async () => null,
    applyCompletion: (ls: string[], cl: number, cc: number) => ({ lines: ls, cursorLine: cl, cursorCol: cc }),
  } as any;

  private setupModelNavigation(): void {
    // Remove old listener
    if (this.modelSetupInputListener) {
      this.modelSetupInputListener();
      this.modelSetupInputListener = null;
    }

    const state = this.modelSetup;
    if (!state) return;

    // Use tui.addInputListener to intercept arrow/enter keys globally.
    // This is needed because pi-tui's Editor consumes arrow keys internally
    // before PromptInput.handleInput sees them.
    const handleModelNav = (data: string) => {
      if (data === "\x1b[A") {
        if (state.step === "provider") {
          state.selectedIndex = Math.max(0, state.selectedIndex - 1);
          this.renderModelSetup();
        } else if (state.step === "model") {
          state.selectedIndex = Math.max(0, state.selectedIndex - 1);
          this.renderModelSetup();
        } else if (state.step === "reasoning") {
          state.selectedIndex = Math.max(0, state.selectedIndex - 1);
          this.renderModelSetup();
        }
        return { consume: true };
      }
      if (data === "\x1b[B") {
        if (state.step === "provider") {
          state.selectedIndex = Math.min(state.providers.length - 1, state.selectedIndex + 1);
          this.renderModelSetup();
        } else if (state.step === "model") {
          state.selectedIndex = Math.min(state.models.length - 1, state.selectedIndex + 1);
          this.renderModelSetup();
        } else if (state.step === "reasoning") {
          state.selectedIndex = Math.min(this.reasoningLevels().length - 1, state.selectedIndex + 1);
          this.renderModelSetup();
        }
        return { consume: true };
      }
      if (data === "\x1b[D") {
        if (state.step === "model" && state.page > 0) {
          state.page--;
          state.selectedIndex = state.page * state.modelsPerPage;
          this.renderModelSetup();
        }
        return { consume: true };
      }
      if (data === "\x1b[C") {
        if (state.step === "model") {
          const totalPages = Math.ceil(state.models.length / state.modelsPerPage);
          if (state.page < totalPages - 1) {
            state.page++;
            state.selectedIndex = state.page * state.modelsPerPage;
            this.renderModelSetup();
          }
        }
        return { consume: true };
      }
      if (data === "\r") {
        if (state.step === "provider") {
          const entry = state.providers[state.selectedIndex];
          if (entry) {
            void this.selectModelSetupProvider(entry.provider).then(() => {
              this.setupModelNavigation();
              this.renderModelSetup();
            });
          }
          return { consume: true };
        }
        if (state.step === "model") {
          const model = state.models[state.selectedIndex];
          if (model) void this.finishModelSetup(String(state.selectedIndex + 1));
          return { consume: true };
        }
        if (state.step === "reasoning") {
          void this.handleModelSetupSubmit(String(state.selectedIndex + 1));
          return { consume: true };
        }
      }
      return undefined;
    };

    this.modelSetupInputListener = this.tui.addInputListener(handleModelNav);
  }

  private async cmdAdvisor(arg: string): Promise<void> {
    if (this.isRunning) return;
    const config = await loadConfig();

    // /advisor off — toggle OFF
    if (arg === "off") {
      config.advisorModel = undefined;
      config.advisorMode = false;
      await saveConfig(config);
      this.advisorModel = undefined;
      this.contextBar.update({ advisorModel: undefined, workerModel: config.defaultModel,
        contextTokens: this.contextTokens, contextWindow: this.contextWindow, mode: this.mode });
      this.addChatLine(`${clr.success("✓")} Advisor mode disabled`);
      return;
    }

    // If already ON, /advisor or /advisor on toggles it OFF
    if (config.advisorMode && (arg === "" || arg === "on")) {
      config.advisorMode = false;
      await saveConfig(config);
      this.contextBar.update({ advisorModel: undefined, workerModel: config.defaultModel,
        contextTokens: this.contextTokens, contextWindow: this.contextWindow, mode: this.mode });
      this.addChatLine(`${clr.success("✓")} Advisor mode disabled`);
      return;
    }

    // Direct model string: /advisor openrouter/anthropic/claude-opus-4.7
    if (arg && arg !== "on") {
      config.advisorModel = arg;
      config.advisorMode = true;
      await saveConfig(config);
      this.advisorModel = arg;
      this.contextBar.update({ advisorModel: arg });
      this.addChatLine(`${clr.success("✓")} Advisor → ${arg}  (mode ON)`);
      return;
    }

    // /advisor or /advisor on — activate. Check if already configured.
    if (config.advisorModel) {
      const parts = config.advisorModel.split("/");
      const modelName = parts[parts.length - 1] ?? config.advisorModel;
      const providerName = parts[0] ?? config.defaultProvider;
      // Ask user: keep current or change?
      this.addChatLine(`${clr.bold("Advisor Mode")}`);
      this.addChatLine(`Current Advisor: ${modelName} via ${providerName}`);
      this.addChatLine(`Change configuration? (y/N)`);
      this.tui.requestRender();

      await new Promise<void>((resolve) => {
        const prev = this.promptInput.onSubmit;
        this.promptInput.onSubmit = (val) => {
          this.promptInput.clear();
          this.promptInput.onSubmit = prev;
          const answer = val.trim().toLowerCase();
          if (answer === "y" || answer === "yes") {
            // Enter configuration setup
            void this.startAdvisorSetup(config).then(resolve);
          } else {
            // Activate with current config
            config.advisorMode = true;
            void saveConfig(config).then(() => {
              this.addChatLine(`${clr.success("✓")} Advisor mode ON — ${modelName} via ${providerName}`);
              this.tui.requestRender();
              resolve();
            });
          }
        };
      });
      return;
    }

    // Not configured — force setup
    this.addChatLine(`${clr.bold("Advisor Mode")} — no advisor configured. Let's set one up.`);
    await this.startAdvisorSetup(config);
  }

  /** Start advisor model setup — show provider picker, then model list */
  private async startAdvisorSetup(config: Config): Promise<void> {
    // Build provider list: configured first, then unconfigured
    const configured: ProviderEntry[] = [];
    const unconfigured: ProviderEntry[] = [];
    for (const provider of MODEL_PROVIDERS) {
      const stored = providerConfig(config, provider.key);
      if (stored?.apiKey) {
        configured.push({ provider, configured: true, valid: true, keyPreview: maskKey(stored.apiKey) });
      } else {
        unconfigured.push({ provider, configured: false, valid: false, keyPreview: "" });
      }
    }

    this.modelSetup = {
      step: "provider",
      config,
      currentProvider: config.defaultProvider,
      models: [],
      providers: [...configured, ...unconfigured],
      selectedIndex: 0,
      page: 0,
      modelsPerPage: 20,
      isAdvisorMode: true,
    };

    this.promptInput.clear();
    this.promptInput.setSecretMode(false);
    this.autocompleteText.setText("");
    this.setupModelNavigation();
    this.renderModelSetup();
    void this.validateProviderKeys();
  }

  private cmdMode(arg: string): void {
    const modes: Mode[] = ["EXPLORE", "PLAN", "DEBUG"];
    if (!arg) {
      this.addChatLine(`  mode: ${this.mode}  |  options: ${modes.join(" · ")}`);
      return;
    }
    const m = arg.toUpperCase() as Mode;
    if (modes.includes(m)) {
      const prev = this.mode;
      this.mode = m;
      setCurrentMode(m);
      this.contextBar.update({ mode: m });
      this.syncModeColor();
      this.addChatLine(`  ${A.fg(MODE_COLORS[prev] ?? 34, prev)} → ${A.fg(MODE_COLORS[m] ?? 34, m)}`);
    } else {
      this.addChatLine(`  ${clr.error("✗")} Unknown mode. Options: ${modes.join(", ")}`);
    }
  }

  private async cmdReason(arg: string): Promise<void> {
    const valid = this.reasoningLevels();
    if (!arg) {
      this.addChatLine(`  reasoning: ${this.reasoningDisplayLabel()}  |  options: ${this.reasoningLevelsLabel()}`);
      return;
    }

    const level = this.parseReasoningLevel(arg);
    if (level === null || !valid.includes(level)) {
      this.addChatLine(`  ${clr.error("✗")} Valid levels: ${this.reasoningLevelsLabel()}`);
      return;
    }
    await this.setReasoningLevel(level);
  }

  private async cmdUser(_arg: string): Promise<void> {
    const config = await loadConfig();
    const profile = config.userProfile;

    // Show current profile
    this.addChatLine("");
    this.addChatLine(`  ${clr.bold("User Profile")}`);
    this.addChatLine(`  ${clr.dim("name")}         ${profile?.name || clr.dim("(not set)")}`);
    this.addChatLine(`  ${clr.dim("preference")}   ${profile?.responsePreference || clr.dim("concise")}`);
    this.addChatLine(`  ${clr.dim("instructions")} ${profile?.customInstructions || clr.dim("(none)")}`);
    this.addChatLine("");

    // Ask if user wants to edit
    this.addChatLine(`  ${clr.dim("Edit profile? (y/n)")}`);
    this.tui.requestRender();

    const key = await this.readKey();
    if (key === "y" || key === "\r") {
      // Stop TUI, run onboarding flow, restart TUI
      this.tui.stop();
      const { runOnboarding } = await import("../index.js");
      await runOnboarding();
      const newConfig = await loadConfig();
      this.userName = newConfig.userProfile?.name || "you";
      this.tui.start();
      this.tui.setFocus(this.promptInput);
      this.addChatLine(`  ${clr.success("✓")} Profile updated`);
    } else {
      this.addChatLine(`  ${clr.dim("Profile unchanged")}`);
    }
    this.addChatLine("");
    this.tui.requestRender();
  }

  private printHelp(): void {
    const reasonLevels = this.reasoningLevelsLabel();
    const h = [
      "",
      `  ${clr.bold("Commands")}`,
      clr.dim("  ─────────────────────────────────────────"),
      `  ${clr.tool("/advisor on")}      ${clr.dim("Set advisor model")}`,
      `  ${clr.tool("/advisor off")}     ${clr.dim("Disable advisor")}`,
      `  ${clr.tool("/advisor <model>")} ${clr.dim("Set advisor directly")}`,
      `  ${clr.tool("/model")} - ${clr.dim("Choose provider/API key/model")}`,
      `  ${clr.tool("/mode <MODE>")}     ${clr.dim("EXPLORE · PLAN · DEBUG")}`,
      `  ${clr.tool("/reason <level>")} ${clr.dim(reasonLevels.replace(/\|/g, "·"))}`,
      `  ${clr.tool("/new [name]")}      ${clr.dim("Start new session")}`,
      `  ${clr.tool("/user")}            ${clr.dim("View/update profile & preferences")}`,
      `  ${clr.tool("/debug")}           ${clr.dim("Toggle debug logging")}`,
      `  ${clr.tool("/help ")}${clr.dim("This message")}`,
      `  ${clr.tool("/exit ")}${clr.dim("Quit")}`,
      "",
      `  ${clr.bold("Keyboard")}`,
      clr.dim("  ─────────────────────────────────────────"),
      `  ${clr.dim("Tab")}              ${clr.dim("Cycle mode forward")}`,
      `  ${clr.dim("Shift+Tab")}        ${clr.dim(`Cycle reasoning level (${reasonLevels})`)}`,
      `  ${clr.dim("Ctrl+C")}           ${clr.dim("Abort current turn")}`,
      `  ${clr.dim("Ctrl+D")}           ${clr.dim("Exit")}`,
      "",
    ];
    for (const line of h) this.addChatLine(line);
  }
}
