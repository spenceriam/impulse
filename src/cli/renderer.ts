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
  Input,
  truncateToWidth,
  wrapTextWithAnsi,
  type Component,
  type Focusable,
  type OverlayHandle,
} from "@mariozechner/pi-tui";
import { ContextBarComponent } from "./components/context-bar.js";
import { BottomAnchorSpacer } from "./components/bottom-anchor-spacer.js";
import { ToolBlock } from "./components/tool-block.js";
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
  WORK: 34, EXPLORE: 32, PLAN: 33, DEBUG: 31,
};

// ── PromptInput: wraps pi-tui Input, intercepts special keys ─────────────────

export class PromptInput implements Component, Focusable {
  focused = false;

  private inner = new Input();
  private _modeColorCode = 34; // ANSI color code for the ❯ arrow (matches mode)
  // Paste state
  private _pasteContent: string | null = null;
  private _pasteDisplay: string | null = null;
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

  get onSubmit() { return this.inner.onSubmit; }
  set onSubmit(fn: ((v: string) => void) | undefined) {
    if (fn !== undefined) this.inner.onSubmit = fn;
    else this.inner.onSubmit = undefined as unknown as (value: string) => void;
  }

  /** Returns the real value (actual paste content if applicable) */
  getSubmitValue(): string {
    const displayed = this.inner.getValue();
    if (this._pasteContent !== null && this._pasteDisplay !== null) {
      if (displayed.includes(this._pasteDisplay)) {
        return displayed.replace(this._pasteDisplay, this._pasteContent);
      }
      return this._pasteContent;
    }
    return displayed;
  }

  clear(): void {
    this.inner.setValue("");
    this._pasteContent = null;
    this._pasteDisplay = null;
    this._isPasting = false;
    this._pasteBuffer = "";
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

    const pasteDisplayBeforeInput = this._pasteDisplay;

    this.inner.handleInput(data);

    // If the visible paste token was edited away, drop the hidden payload.
    // Do this AFTER inner.handleInput so Enter can still submit the real paste.
    if (pasteDisplayBeforeInput !== null && !this.inner.getValue().includes(pasteDisplayBeforeInput)) {
      this._pasteContent = null;
      this._pasteDisplay = null;
    }

    this.onChange?.(this.inner.getValue());
  }

  private _finalizePaste(): void {
    this._isPasting = false;
    const content = this._pasteBuffer;
    this._pasteBuffer = "";
    const lines = content.split("\n").filter((l) => l.length > 0);

    if (lines.length > 1) {
      // Multi-line paste — show indicator, store real content
      this._pasteContent = content;
      this._pasteDisplay = `[Pasted ${lines.length} lines  ${content.length} chars]`;
      this.inner.handleInput(this._pasteDisplay);
    } else if (content.length > 120) {
      // Long single-line paste — show indicator
      this._pasteContent = content;
      this._pasteDisplay = `[Pasted ${content.length} chars]`;
      this.inner.handleInput(this._pasteDisplay);
    } else {
      // Short paste — insert normally
      this._pasteContent = null;
      this._pasteDisplay = null;
      this.inner.handleInput("\x1b[200~" + content + "\x1b[201~");
    }
  }

  invalidate(): void { this.inner.invalidate(); }

  render(width: number): string[] {
    // pi-tui Input renders its own "> " prefix; replace it with the mode-colored arrow.
    const innerWidth = Math.max(2, width - 2);
    const innerLines = this.inner.render(innerWidth);
    const firstLine = innerLines[0] ?? "";
    const content = firstLine.startsWith("> ") ? firstLine.slice(2) : firstLine;
    const ARROW = `  \x1b[${this._modeColorCode}m\u276f\x1b[0m `;

    if (this._secretMode) {
      const valueLength = this.inner.getValue().length;
      const masked = valueLength > 0 ? "*".repeat(Math.min(valueLength, Math.max(0, width - 4))) : "";
      return [truncateToWidth(ARROW + masked, width)];
    }

    return [
      truncateToWidth(ARROW + content, width),
      ...innerLines.slice(1).map((line) => truncateToWidth("    " + line, width)),
    ];
  }
}

// ── SeparatorLine: a fixed dim horizontal rule ────────────────────────────────

class SeparatorLine implements Component {
  invalidate() {}
  render(width: number): string[] {
    return [A.dim + "─".repeat(width) + A.reset];
  }
}

class ThinkingBlock implements Component {
  private raw = "";

  setText(text: string): void {
    this.raw = text;
  }

  render(width: number): string[] {
    const prefix = "   ";
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

type ModelSetupStep = "provider" | "baseUrl" | "apiKey" | "discovering" | "model";

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
  private spinnerMsg = "";
  private spinnerFlavor = "";
  private readonly SPIN_FRAMES = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
  private readonly STATUS_FLAVORS = [
    "warming up the neurons…",
    "herding the tokens…",
    "poking the shell…",
    "keeping the checklist honest…",
    "checking the wires…",
    "asking nicely…",
    "untangling the context…",
    "lining up the bytes…",
  ];

  private pickBusyFlavor(action: string): string {
    const normalized = action.toLowerCase();
    if (normalized.includes("question") || normalized.includes("answer") || normalized.includes("user")) {
      return "asking nicely…";
    }
    if (normalized.includes("bash") || normalized.includes("shell") || normalized.includes("command")) {
      return "poking the shell…";
    }
    if (normalized.includes("todo")) {
      return "keeping the checklist honest…";
    }
    if (normalized.includes("compact")) {
      return "untangling the context…";
    }
    if (normalized.includes("respond") || normalized.includes("model")) {
      return "herding the tokens…";
    }
    if (normalized.includes("think")) {
      return "warming up the neurons…";
    }
    const flavor = this.STATUS_FLAVORS[this.turnPhraseIndex % this.STATUS_FLAVORS.length];
    this.turnPhraseIndex += 1;
    return flavor ?? "working…";
  }

  private renderBusyLine(): void {
    if (!this.spinnerMsg) {
      this.spinnerText.setText("");
      return;
    }

    const frameIndex = Math.floor(Date.now() / 160) % this.SPIN_FRAMES.length;
    const frame = this.SPIN_FRAMES[frameIndex] ?? this.SPIN_FRAMES[0] ?? "…";
    const flavor = this.spinnerFlavor ? `${A.dim}${this.spinnerFlavor}${A.reset}  ` : "";
    this.spinnerText.setText(`  ${A.dim}${frame}${A.reset}  ${flavor}${this.spinnerMsg}`);
  }

  private spinStart(msg: string): void {
    this.spinnerMsg = msg;
    this.spinnerFlavor = this.pickBusyFlavor(msg);
    this.renderBusyLine();
    this.tui.requestRender();
    if (this.spinnerInterval) return;
    this.spinnerInterval = setInterval(() => {
      this.renderBusyLine();
      this.tui.requestRender();
    }, 80);
  }

  private spinStop(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    this.spinnerMsg = "";
    this.spinnerFlavor = "";
    this.spinnerText.setText("");
    this.tui.requestRender();
  }

  private setBusyStatus(msg: string): void {
    if (this.spinnerInterval && this.spinnerMsg === msg) {
      return;
    }

    if (!this.spinnerInterval) {
      this.spinStart(msg);
      return;
    }

    this.spinnerMsg = msg;
    this.spinnerFlavor = this.pickBusyFlavor(msg);
    this.renderBusyLine();
    this.tui.requestRender();
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
  private streamingText: Text | null = null;
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
  private turnPhraseIndex = 0;

  // Agent + state
  private loop = new AgentLoop();
  private mode: Mode = "WORK";
  private contextTokens = 0;
  private contextWindow = 200000;
  private advisorModel: string | undefined;
  private reasoningLevel: ReasoningLevel = "medium";
  private reasoningCapability: ReasoningCapability = { supported: true, style: "binary", levels: ["off", "medium"] };
  private isRunning = false;
  private modelSetup: ModelSetupState | null = null;
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
      `  ${clr.bold("IMPULSE")} ${A.dim}|${A.reset} cli coding agent ${A.dim}|${A.reset} ${A.fg(90, "v" + (packageJson as {version:string}).version)}`,
      0, 0
    ));
    this.chat.addChild(new Text(
      `  ${A.fg(90, "Tab: agent mode  |  Shift+Tab: reasoning  |  /help: commands  |  Esc/Ctrl+C: abort  |  Ctrl+D: exit")}`,
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
    this.promptInput = new PromptInput();
    this.promptInput.onSubmit = (_displayedValue) => {
      const actual = this.promptInput.getSubmitValue();
      this.promptInput.clear();
      this.autocompleteText.setText("");
      if (this.modelSetup) void this.handleModelSetupSubmit(actual);
      else void this.onSubmit(actual);
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
    const modes: Mode[] = ["WORK", "EXPLORE", "PLAN", "DEBUG"];
    const prev = this.mode;
    const idx = modes.indexOf(this.mode);
    this.mode = modes[((idx + dir) + modes.length) % modes.length]!;
    setCurrentMode(this.mode);
    this.contextBar.update({ mode: this.mode });
    this.syncModeColor();

    const modeLine = `   ${A.fg(MODE_COLORS[prev] ?? 34, prev)} → ${A.fg(MODE_COLORS[this.mode] ?? 34, this.mode)}`;
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
    return Math.ceil(JSON.stringify(session.messages).length / 4);
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

    await this.runTurn(input);
  }

  // ── Agent turn ────────────────────────────────────────────────────────────

  private async runTurn(userMessage: string): Promise<void> {
    this.isRunning = true;
    this.modeChangeText = null; // Reset mode change tracking for new turn

    // User message block
    this.addSectionGap();
    this.addChatLine(`   ${A.fg(36, this.userName)}`);
    this.addChatLine(`   ${userMessage}`);
    this.addSectionGap();

    this.streamingRaw = "";
    this.streamingText = null;
    this.thinkingRaw = "";
    this.thinkingText = null;
    this.thinkingOpen = false;
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
        this.setBusyStatus("thinking…");
      },
      onToken: (text) => {
        this.setBusyStatus("responding…");
        this.closeThinking();
        if (!this.streamingText) {
          // Add Impulse response header on first token
          this.addSectionGap();
          this.chat.addChild(new Text(`   ${A.fg(33, "Impulse")}${A.reset}`, 0, 0));
          this.hasTrailingGap = false;
          this.streamingText = new Text("", 0, 0);
          this.chat.addChild(this.streamingText);
          this.hasTrailingGap = false;
        }
        this.streamingRaw += text;
        this.streamingText.setText("   " + this.streamingRaw.replace(/\n/g, "\n   "));
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
        this.tui.requestRender();
      },
      onAdvisorStart: (model) => {
        const short = model.split("/").pop() ?? model;
        this.setBusyStatus(`consulting ${short}…`);
        this.addChatLine(`  ${clr.dim(`[advisor • consulting ${short}…]`)}`);
        this.tui.requestRender();
      },
      onAdvisorToken: (_text) => { /* buffered */ },
      onAdvisorEnd: (summary) => {
        const raw = summary.trim();
        const oneliner = raw.split(/[.!?\n]/)[0]?.trim() ?? raw;
        const truncated = oneliner.length > 80 ? oneliner.slice(0, 77) + "…" : oneliner;
        // Replace last chat line with summary
        this.addChatLine(`  ${clr.dim(`[advisor: ${truncated}]`)}`);
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
        this.setBusyStatus(name === "question" ? "responding…" : "waiting for model…");
        this.tui.requestRender();
      },
      onCompacting: () => {
        this.addChatLine(`  ${clr.warn("⟳")}  ${clr.dim("compacting context…")}`);
        this.setBusyStatus("compacting context…");
        this.tui.requestRender();
      },
      onCompacted: (removedCount) => {
        this.addChatLine(`  ${clr.success("✓")}  ${clr.dim(`compacted — removed ${removedCount} messages`)}`);
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
        this.addChatLine(`  ${clr.error("Error:")} ${err.message}`);
        this.isRunning = false;
        this.tui.setFocus(this.promptInput);
        this.tui.requestRender();
      },
    };

    await this.loop.run(userMessage, this.mode, events);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private addChatLine(text: string): void {
    this.chat.addChild(new Text(text, 0, 0));
    this.hasTrailingGap = false;
  }

  private addSectionGap(): void {
    if (this.hasTrailingGap) return;
    this.chat.addChild(new Spacer(1));
    this.hasTrailingGap = true;
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
    // + autocompleteText (variable) + promptInput (1) + SeparatorLine (1) + contextBar (1)
    let otherLines = 7;

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
    this.addChatLine(`  ${clr.dim("─".repeat(46))}`);
    this.addChatLine(`  ${clr.bold("Session summary")}`  );
    this.addChatLine(`  ${clr.dim("session")}   ${session.name}`);
    this.addChatLine(`  ${clr.dim("duration")}  ${dur}`);
    this.addChatLine(`  ${clr.dim("turns")}     ${turns}`);
    this.addChatLine(`  ${clr.dim("messages")}  ${msgs}`);
    this.addChatLine(`  ${clr.dim("model")}     ${session.model || "(none)"}`);
    this.addChatLine(`  ${clr.dim("─".repeat(46))}`);
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
        this.addChatLine(`  ${clr.success("✓")} Debug logging ${isDebugEnabled() ? "enabled" : "disabled"}`);
        if (isDebugEnabled()) {
          debugLog(`Debug logging enabled`);
        }
        break;
      case "new":
        await SessionManager.createNew(arg || undefined);
        this.addChatLine(`  ${clr.success("✓")} New session started`);
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
        this.addChatLine(`  ${clr.warn("?")} Unknown: /${cmd} — try /help`);
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
      lines.push(clr.bold("MODEL SETUP"));
      lines.push(clr.dim("─────────────────────────────────────────────────"));
      lines.push("");
      lines.push(`Discovering ${state.provider?.label ?? "provider"} models...`);
      lines.push("");
      lines.push(clr.dim("Testing connection..."));
    } else if (state.step === "model") {
      lines.push(clr.bold("MODEL SETUP"));
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

    this.modelSetupText.setText(lines.join("\n"));
    this.tui.requestRender();
  }

  private selectModelSetupProvider(provider: ModelProviderOption): void {
    const state = this.modelSetup;
    if (!state) return;

    const existing = providerConfig(state.config, provider.key);
    state.provider = provider;
    state.existing = existing;
    const baseUrl = existing.baseUrl ?? provider.defaultBaseUrl;
    if (baseUrl) state.baseUrl = baseUrl;
    else delete state.baseUrl;
    delete state.error;
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
    this.modelSetup = null;
    this.modelSetupText.setText("");
    this.promptInput.setSecretMode(false);
    this.promptInput.clear();
    // Clear navigation callbacks
    this.promptInput.onArrowUp = null;
    this.promptInput.onArrowDown = null;
    this.promptInput.onArrowLeft = null;
    this.promptInput.onArrowRight = null;
    this.promptInput.onEnter = null;
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
      this.selectModelSetupProvider(provider);
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
      this.renderModelSetup();
      return;
    }

    if (state.step === "model") {
      await this.finishModelSetup(input);
    }
  }

  private async finishModelSetup(modelChoice: string): Promise<void> {
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
    this.contextBar.update({
      workerModel: selectedModel,
      reasoningLevel: this.reasoningDisplayLabel(),
      contextTokens: this.contextTokens,
      contextWindow: this.contextWindow,
      mode: this.mode,
    });

    this.modelSetup = null;
    this.modelSetupText.setText("");
    this.promptInput.setSecretMode(false);
    this.promptInput.clear();
    this.addChatLine(`  ${clr.success("[OK]")} Provider: ${provider.label}`);
    this.addChatLine(`  ${clr.success("[OK]")} Model: ${selectedModel}`);
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
      this.selectModelSetupProvider(provider);
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

  private setupModelNavigation(): void {
    // Clear any existing navigation callbacks
    this.promptInput.onArrowUp = null;
    this.promptInput.onArrowDown = null;
    this.promptInput.onArrowLeft = null;
    this.promptInput.onArrowRight = null;
    this.promptInput.onEnter = null;

    // Set up callbacks based on current step
    const state = this.modelSetup;
    if (!state) return;

    if (state.step === "provider") {
      this.promptInput.onArrowUp = () => {
        state.selectedIndex = Math.max(0, state.selectedIndex - 1);
        this.renderModelSetup();
      };
      this.promptInput.onArrowDown = () => {
        state.selectedIndex = Math.min(state.providers.length - 1, state.selectedIndex + 1);
        this.renderModelSetup();
      };
      this.promptInput.onEnter = () => {
        const entry = state.providers[state.selectedIndex];
        if (entry) {
          this.selectModelSetupProvider(entry.provider);
          this.setupModelNavigation();  // Re-setup for next step
          this.renderModelSetup();
        }
      };
    } else if (state.step === "model") {
      this.promptInput.onArrowUp = () => {
        state.selectedIndex = Math.max(0, state.selectedIndex - 1);
        this.renderModelSetup();
      };
      this.promptInput.onArrowDown = () => {
        state.selectedIndex = Math.min(state.models.length - 1, state.selectedIndex + 1);
        this.renderModelSetup();
      };
      this.promptInput.onArrowLeft = () => {
        if (state.page > 0) {
          state.page--;
          state.selectedIndex = state.page * state.modelsPerPage;
          this.renderModelSetup();
        }
      };
      this.promptInput.onArrowRight = () => {
        const totalPages = Math.ceil(state.models.length / state.modelsPerPage);
        if (state.page < totalPages - 1) {
          state.page++;
          state.selectedIndex = state.page * state.modelsPerPage;
          this.renderModelSetup();
        }
      };
      this.promptInput.onEnter = () => {
        const model = state.models[state.selectedIndex];
        if (model) {
          void this.finishModelSetup(String(state.selectedIndex + 1));
        }
      };
    }
  }

  private async cmdAdvisor(arg: string): Promise<void> {
    const config = await loadConfig();

    if (arg === "off") {
      const { advisorModel: _r, ...rest } = config;
      await saveConfig(rest as Config);
      this.advisorModel = undefined;
      this.contextBar.update({ workerModel: config.defaultModel, contextTokens: this.contextTokens,
        contextWindow: this.contextWindow, mode: this.mode });
      this.addChatLine(`  ${clr.success("✓")} Advisor disabled`);
      return;
    }

    if (arg === "on" || arg === "") {
      this.addChatLine(`  ${clr.bold("Advisor model")}  ${clr.dim("e.g. openrouter/anthropic/claude-opus-4.7")}`);
      this.addChatLine(`  ${clr.dim("Type the model string and press Enter:")}`);
      this.tui.requestRender();

      await new Promise<void>((resolve) => {
        const prev = this.promptInput.onSubmit;
        this.promptInput.onSubmit = (val) => {
          this.promptInput.clear();
          this.promptInput.onSubmit = prev;
          if (val.trim()) {
            config.advisorModel = val.trim();
            void saveConfig(config).then(() => {
              this.advisorModel = val.trim();
              this.contextBar.update({ advisorModel: val.trim() });
              this.addChatLine(`  ${clr.success("✓")} Advisor → ${val.trim()}`);
              this.tui.requestRender();
            });
          } else {
            this.addChatLine(`  ${clr.dim("Cancelled")}`);
          }
          resolve();
        };
      });
      return;
    }

    config.advisorModel = arg;
    await saveConfig(config);
    this.advisorModel = arg;
    this.contextBar.update({ advisorModel: arg });
    this.addChatLine(`  ${clr.success("✓")} Advisor → ${arg}`);
  }

  private cmdMode(arg: string): void {
    const modes: Mode[] = ["WORK", "EXPLORE", "PLAN", "DEBUG"];
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
      `  ${clr.tool("/mode <MODE>")}     ${clr.dim("WORK · EXPLORE · PLAN · DEBUG")}`,
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
