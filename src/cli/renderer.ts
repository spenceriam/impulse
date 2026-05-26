/**
 * ImpulseRenderer ? full TUI using @mariozechner/pi-tui
 *
 * Layout (top ? bottom, viewport shows bottom when content overflows):
 *   chatContainer     ? conversation history (grows upward as turns add content)
 *   loaderLine        ? Braille spinner while agent works (Loader component)
 *   ?? separator ??   ? always visible divider
 *   contextBar        ? model ? tokens ? dir ? branch ? mode ? stats
 *   promptInput       ? [MODE] ? _   (Input component, Tab cycles modes)
 *
 * Sticky bar: pi-tui renders all children top?bottom and shows the last N
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
import type { EditorTheme } from "@mariozechner/pi-tui";
import { PromptInput, type PromptSubmitPayload } from "./prompt-input.js";
import { shouldShowSlashAutocomplete } from "./slash-autocomplete.js";
import { GUTTER, GUTTER_WIDTH, gutterSeparator } from "./gutter.js";
import { dimRuleIndented } from "./format-helpers.js";

/** pi-tui maxHeight for session/model list overlays */
const LIST_OVERLAY_MAX_HEIGHT = 18;
import { overlayMinWidth } from "./layout.js";
import { toggleExpress, isExpressMode, acknowledgeExpress } from "../permission/index.js";
import { ContextBarComponent } from "./components/context-bar.js";
import { BottomAnchorSpacer } from "./components/bottom-anchor-spacer.js";
import { ToolBlock } from "./components/tool-block.js";
import { MarkdownTextBlock } from "./components/markdown-text.js";
import { PermissionOverlay } from "./components/permission-overlay.js";
import { QuestionOverlay } from "./components/question-overlay.js";
import { SessionPickerOverlay } from "./components/session-picker-overlay.js";
import { ProfileOverlay } from "./components/profile-overlay.js";
import { SelectableListOverlay } from "./components/selectable-list-overlay.js";
import {
  buildModelSetupRows,
  buildReasoningSetupRows,
  MANUAL_MODEL_ROW_ID,
} from "./model-setup-rows.js";
import { sessionHasResumeableContent } from "../session/session-content.js";
import { AgentLoop, type LoopEvents } from "../agent/loop.js";
import { load as loadConfig, save as saveConfig, type Config, type ReasoningLevel } from "../util/config.js";
import {
  PROVIDER_REASONING_STYLE,
  getLevelsForStyle,
  cycleReasoningLevel,
  formatReasoningLevelForDisplay,
  discoverOllamaReasoning,
  discoverOllamaMaxOutputTokens,
  probeReasoningSupport,
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
import { HeaderEvents, QuestionEvents } from "../bus/events.js";
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
import { Global } from "../global.js";

// ?? Debug logging ????????????????????????????????????????????????????????????
const debugLogPath = path.join(Global.Path.logs, "debug.log");
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

// ?? ANSI helpers ??????????????????????????????????????????????????????????????
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

/** User-visible success status (AGENTS.md: [OK], not ?). */
const statusOk = (message: string) => `${clr.success("[OK]")} ${message}`;

// ANSI color per mode ? used for prompt arrow and context bar mode label
const MODE_COLORS: Record<string, number> = {
  AGENT: 34, EXPLORE: 32, PLAN: 33, DEBUG: 31,
};

/** Mode transition in chat (ASCII for Windows/macOS/Linux terminal fonts). */
const MODE_ARROW = " -> ";

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

// ?? SeparatorLine: a fixed dim horizontal rule ????????????????????????????????

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

type ModelSetupStep =
  | "provider"
  | "providerName"
  | "baseUrl"
  | "apiKey"
  | "discovering"
  | "model"
  | "modelManual"
  | "reasoning";

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
  customProviderName?: string;  // Slug for custom providers (e.g. "my-llm")
  error?: string;
  // Navigation state
  providers: ProviderEntry[];  // Configured providers first, then unconfigured
  selectedIndex: number;       // Currently selected provider/model index
  page: number;                // Current page for model list
  modelsPerPage: number;       // Models per page (default: 20)
}

// ?? ImpulseRenderer ???????????????????????????????????????????????????????????

export type ResumeStartup = "picker" | { sessionId: string };

export interface ImpulseRendererOptions {
  resume?: ResumeStartup;
}

export class ImpulseRenderer {
  // pi-tui objects
  private terminal = new ProcessTerminal();
  private tui!: TUI;
  private readonly startupResume: ResumeStartup | null;
  /** Chat children below welcome header (fixed); cleared on /new and /resume */
  private welcomeChildCount = 0;

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
    "Processing..",
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
    if (normalized.includes("think")) return 16;             // "Processing.."
    if (normalized.includes("respond")) return 25;            // "...putting a thought together..."
    if (normalized.includes("bash") || normalized.includes("shell")) return 22; // "...running the calculations..."
    if (normalized.includes("question") || normalized.includes("approval")) return 41; // "...awaiting response..."
    if (normalized.includes("waiting")) return 41;            // "...awaiting response..."
    if (normalized.includes("compact")) return 33;            // "...organizing the response..."
    if (normalized.includes("todo")) return 5;                // "...let's break this down..."
    if (normalized.includes("consult")) return 1;             // "...handling that now..."
    // Fallback: pick a random phrase so the same action shows variety
    const available = ImpulseRenderer.STATUS_PHRASES.filter((_, i) => i !== this.statusPhraseIndex);
    return available.length > 0
      ? ImpulseRenderer.STATUS_PHRASES.indexOf(available[Math.floor(Math.random() * available.length)]!)
      : Math.floor(Math.random() * ImpulseRenderer.STATUS_PHRASES.length);
  }

  private shimmerBusyText(message: string, dimBase = false): string {
    const chars = Array.from(message);
    if (chars.length === 0) return "";

    const head = Math.floor(Date.now() / 80) % chars.length;
    const baseDim = 238;
    const baseMid = dimBase ? 240 : 236;
    const peak = dimBase ? 248 : 248;

    return chars.map((char, index) => {
      if (/\s/.test(char)) return char;
      const distance = Math.min(Math.abs(index - head), chars.length - Math.abs(index - head));
      if (distance === 0) return A.fg(peak, `${A.bold}${char}${A.reset}`);
      if (distance === 1) return A.fg(baseMid, char);
      return A.fg(baseDim, char);
    }).join("");
  }

  private renderBusyLine(): void {
    if (!this.currentStatusPhrase) {
      this.spinnerText.setText("");
      return;
    }
    this.spinnerText.setText(
      `${GUTTER}${this.shimmerBusyText(this.currentStatusPhrase, this.busyDimBase)}`
    );
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
      `${clr.dim("?".repeat(40))}`,
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
        minWidth: this.overlayMin(),
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
      this.addChatLine(statusOk("Advisor mode disabled ? all tasks complete"));
      this.tui.requestRender();
    }
  }

  private toolsRanThisTurn = false;
  private busyDimBase = false;

  private setBusyStatus(msg: string, fixedPhrase?: string): void {
    if (this.spinnerInterval && this.currentStatusPhrase && !fixedPhrase) return;

    this.busyDimBase =
      fixedPhrase === "Processing.." ||
      fixedPhrase === "Wrapping up..." ||
      msg.toLowerCase().includes("think");

    if (fixedPhrase) {
      this.currentStatusPhrase = fixedPhrase;
    } else {
      this.statusPhraseIndex = this.pickPhraseIndex(msg);
      this.currentStatusPhrase =
        ImpulseRenderer.STATUS_PHRASES[this.statusPhraseIndex] ?? "Processing..";
    }
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
    this.setBusyStatus("waiting for your approval?");

    const overlay = new PermissionOverlay(request);
    overlay.onDecision = (response) => {
      const permissionID = request.id;
      const resumeStatus = `running ${request.permission}?`;
      this.dismissPermissionOverlay(resumeStatus);
      respond({ permissionID, response });
    };

    this.permissionOverlayHandle = this.tui.showOverlay(overlay, {
      anchor: "bottom-center",
      offsetY: -4,
      width: "92%",
      minWidth: this.overlayMin(),
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
    this.setBusyStatus("waiting for your answer?");

    const overlay = new QuestionOverlay({ context, questions });
    overlay.onSubmit = (answers) => {
      this.dismissQuestionOverlay(false);
      resolveQuestion(answers);
      if (this.isRunning) {
        this.setBusyStatus("responding?");
      }
    };
    overlay.onAbort = () => {
      this.abortCurrentTurn();
    };

    this.questionOverlayHandle = this.tui.showOverlay(overlay, {
      anchor: "bottom-center",
      offsetY: -4,
      width: "92%",
      minWidth: this.overlayMin(),
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

  private overlayMin(): number {
    return overlayMinWidth(this.tui?.terminal?.columns ?? 80);
  }

  private terminalCols(): number {
    return this.tui?.terminal?.columns ?? this.terminal.columns ?? 80;
  }

  private setupSectionRule(): string {
    return dimRuleIndented(this.terminalCols(), 2);
  }

  private listOverlayMargin(): { left: number; right: number; bottom: number } {
    return { left: GUTTER_WIDTH, right: GUTTER_WIDTH, bottom: 4 };
  }

  private dismissListOverlay(handle: OverlayHandle | null): void {
    handle?.hide();
  }

  private showListOverlay(overlay: Component & { handleInput: (data: string) => void }): OverlayHandle {
    const handle = this.tui.showOverlay(overlay, {
      anchor: "bottom-center",
      offsetY: -4,
      width: "100%",
      minWidth: this.overlayMin(),
      maxHeight: LIST_OVERLAY_MAX_HEIGHT,
      margin: this.listOverlayMargin(),
    });
    handle.focus();
    return handle;
  }

  private dismissModelSetupOverlay(): void {
    this.modelSetupOverlayHandle?.hide();
    this.modelSetupOverlayHandle = null;
  }

  private providerKeyForSetup(state: ModelSetupState): string {
    const p = state.provider!;
    return p.isCustom ? (state.customProviderName ?? p.key) : p.key;
  }

  private async afterModelSelectedInSetup(selectedModel: string): Promise<void> {
    const state = this.modelSetup;
    if (!state?.provider) return;

    state.selectedModel = selectedModel;

    if (
      state.provider.isCustom ||
      (state.provider && !PROVIDER_REASONING_STYLE[state.provider.key])
    ) {
      if (
        state.provider.customType &&
        state.apiKey &&
        state.baseUrl &&
        state.selectedModel
      ) {
        const modelName = state.selectedModel.includes("/")
          ? state.selectedModel.split("/").slice(1).join("/")
          : state.selectedModel;
        this.reasoningCapability = await probeReasoningSupport(
          state.provider.customType,
          state.baseUrl,
          state.apiKey,
          modelName
        );
        if (!this.reasoningCapability.supported) {
          await this.finishModelSetup(state.selectedModel, "off");
          return;
        }
      }
    }

    state.step = "reasoning";
    this.openModelSetupReasoningPicker();
  }

  private openModelSetupModelPicker(): void {
    const state = this.modelSetup;
    if (!state || state.step !== "model") return;

    if (this.modelSetupInputListener) {
      this.modelSetupInputListener();
      this.modelSetupInputListener = null;
    }
    this.dismissModelSetupOverlay();
    const providerKey = this.providerKeyForSetup(state);
    const rows = buildModelSetupRows(providerKey, state.models, {
      allowManual: state.provider?.isCustom,
    });

    const title = state.isAdvisorMode ? "Select advisor model" : "Select model";
    const overlay = new SelectableListOverlay({
      title,
      rows,
      maxHeight: LIST_OVERLAY_MAX_HEIGHT,
      emptyMessage: state.provider?.isCustom
        ? "  No models listed ? choose Type custom model ID"
        : "  No models available",
      helpLines: ["?/? navigate   Enter select   Esc back"],
    });

    overlay.onSelect = (id) => {
      this.dismissModelSetupOverlay();
      if (id === MANUAL_MODEL_ROW_ID) {
        state.step = "modelManual";
        delete state.error;
        this.renderModelSetup();
        this.tui.setFocus(this.promptInput);
        return;
      }
      const full = modelWithProviderPrefix(providerKey, id);
      void this.afterModelSelectedInSetup(full);
    };

    overlay.onCancel = () => {
      this.dismissModelSetupOverlay();
      state.step = "provider";
      state.selectedIndex = 0;
      delete state.error;
      this.setupModelNavigation();
      this.renderModelSetup();
      this.tui.setFocus(this.promptInput);
    };

    this.renderModelSetup();
    this.modelSetupOverlayHandle = this.showListOverlay(overlay);
  }

  private openModelSetupReasoningPicker(): void {
    const state = this.modelSetup;
    if (!state || state.step !== "reasoning") return;

    if (this.modelSetupInputListener) {
      this.modelSetupInputListener();
      this.modelSetupInputListener = null;
    }
    this.dismissModelSetupOverlay();
    const levels = this.reasoningLevels();
    const overlay = new SelectableListOverlay({
      title: "Select reasoning level",
      rows: buildReasoningSetupRows(levels, (l) =>
        this.reasoningDisplayLabel(l)
      ),
      maxHeight: LIST_OVERLAY_MAX_HEIGHT,
      helpLines: [
        "?/? navigate   Enter select (default: medium)   Esc back",
      ],
    });

    overlay.onSelect = (id) => {
      this.dismissModelSetupOverlay();
      const level = id as ReasoningLevel;
      if (state.selectedModel) {
        void this.finishModelSetup(state.selectedModel, level);
      }
    };

    overlay.onCancel = () => {
      this.dismissModelSetupOverlay();
      state.step = "model";
      delete state.error;
      this.openModelSetupModelPicker();
    };

    this.renderModelSetup();
    this.modelSetupOverlayHandle = this.showListOverlay(overlay);
  }

  private lastHeaderLineTitle: string | null = null;

  private async onHeaderTitleUpdated(title: string): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed || trimmed === this.lastHeaderLineTitle) return;
    this.lastHeaderLineTitle = trimmed;
    try {
      await SessionManager.setHeaderTitle(trimmed);
    } catch {
      // session may not exist yet
    }
    this.addChatLine(
      clr.dim(`${GUTTER}${clr.bold("impulse")} ${clr.dim("|")} ${trimmed}`)
    );
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
    this.addChatLine(`  ${clr.warn("!")}  ${clr.dim("aborted")}`);
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
  private sessionPickerHandle: OverlayHandle | null = null;
  private modelPickerHandle: OverlayHandle | null = null;
  private modelSetupOverlayHandle: OverlayHandle | null = null;
  private profileOverlayHandle: OverlayHandle | null = null;
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
  private engageMode = false;
  private modelSetup: ModelSetupState | null = null;
  private pendingPlanApproval: { planPath: string; summary: string } | null = null;
  private userName = "you"; // User's display name (loaded from config)
  private modeChangeText: Text | null = null; // Track mode change line for in-place updates

  constructor(options?: ImpulseRendererOptions) {
    this.startupResume = options?.resume ?? null;
  }

  /** Submit a plain-text message after the TUI is running (CLI initial arg). */
  async submitMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    await this.onSubmit({
      displayMessage: trimmed,
      apiText: trimmed,
      segments: [{ kind: "text", value: trimmed }],
      orderedImages: [],
    });
  }

  async start(): Promise<void> {
    const config = await loadConfig();
    this.mode = normalizeMode(config.defaultMode) as Mode;
    this.advisorModel = config.advisorModel;
    this.reasoningLevel = config.reasoningLevel ?? (config.thinking ? "medium" : "off");
    this.reasoningCapability = await this.reasoningCapabilityForProvider(config.defaultProvider);
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

    // ?? Build TUI layout ??????????????????????????????????????????????????
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
        return;
      }

      if (event.type === HeaderEvents.Updated.name) {
        const { title } = event.properties as { title: string };
        void this.onHeaderTitleUpdated(title);
      }
    });

    // 0. Bottom anchor spacer ? pushes content down so contextBar stays at terminal bottom
    this.bottomSpacer = new BottomAnchorSpacer(this.tui, () => this.getContentHeight());
    this.tui.addChild(this.bottomSpacer);

    // 1. Chat history ? grows as turns are added
    this.chat = new Container();
    this.tui.addChild(this.chat);

    // Welcome header
    this.chat.addChild(new Spacer(1));
    this.chat.addChild(new Text(
      `${GUTTER}${clr.bold("impulse")} ${clr.dim("|")} ${A.reset}cli coding agent ${clr.dim("|")} ${clr.dim("v" + (packageJson as {version:string}).version)}`,
      0, 0
    ));
    const hintAvail = Math.max(8, this.terminal.columns - GUTTER_WIDTH);
    for (const line of wrapTextWithAnsi(
      "Tab: agent mode  |  Shift+Tab: reasoning  |  /help: commands  |  Esc/Ctrl+C: abort  |  Ctrl+D: exit",
      hintAvail
    )) {
      this.chat.addChild(new Text(`${GUTTER}${A.fg(90, line)}`, 0, 0));
    }
    this.chat.addChild(new Spacer(1));
    this.welcomeChildCount = (this.chat as Container & { children: Component[] }).children.length;

    // 2. Spacer + turn-status line above the prompt
    this.tui.addChild(new Spacer(1));
    this.spinnerText = new Text("", 0, 0);
    this.tui.addChild(this.spinnerText);

    // 3. Separator ABOVE input
    this.tui.addChild(new SeparatorLine());

    this.modelSetupText = new Text("", 0, 0);
    this.tui.addChild(this.modelSetupText);

    // Slash command autocomplete ? shown only when input starts with /
    this.autocompleteText = new Text("", 0, 0);
    this.tui.addChild(this.autocompleteText);

    // 4. Prompt input (just ? , no mode label)
    this.promptInput = new PromptInput(this.tui, EDITOR_THEME);
    this.promptInput.onSubmit = (payload) => {
      this.promptInput.clear();
      this.autocompleteText.setText("");
      if (this.modelSetup) void this.handleModelSetupSubmit(payload.apiText);
      else void this.onSubmit(payload);
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
        void this.showExitStats();
        this.tui.stop();
        process.exit(0);
      }
    };
    this.promptInput.onExit = () => { void this.showExitStats(); this.tui.stop(); process.exit(0); };
    this.promptInput.onEscape = () => {
      if (this.modelSetup) {
        const state = this.modelSetup;
        // Go back to previous step, or cancel if at first step
        if (state.step === "modelManual") {
          state.step = "model";
          delete state.error;
          this.openModelSetupModelPicker();
        } else if (state.step === "model" || state.step === "discovering") {
          this.dismissModelSetupOverlay();
          state.step = "provider";
          delete state.error;
          this.setupModelNavigation();
          this.renderModelSetup();
          this.tui.setFocus(this.promptInput);
        } else if (state.step === "providerName") {
          state.step = state.provider?.isCustom ? "providerName" : "provider";
          delete state.error;
          this.setupModelNavigation();
          this.renderModelSetup();
        } else if (state.step === "apiKey") {
          if (state.provider?.isCustom) {
            state.step = "baseUrl";
          } else if (state.provider?.needsBaseUrl) {
            state.step = "baseUrl";
          } else {
            state.step = "provider";
          }
          delete state.error;
          this.setupModelNavigation();
          this.renderModelSetup();
        } else if (state.step === "baseUrl") {
          state.step = state.provider?.isCustom ? "providerName" : "provider";
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

    // 6. Context bar ? sticky absolute bottom
    this.contextBar = new ContextBarComponent({
      workerModel: config.defaultModel,
      contextTokens: this.contextTokens,
      contextWindow: this.contextWindow,
      mode: this.mode,
      reasoningLevel: this.reasoningDisplayLabel(),
      ...(this.advisorModel ? { advisorModel: this.advisorModel } : {}),
      ...(config.visionModel ? { visionModel: config.visionModel } : {}),
      visionMode: config.visionMode ?? false,
    });
    this.tui.addChild(this.contextBar);

    // ?? Start TUI (takes over terminal raw mode) ??????????????????????????
    this.syncModeColor(); // set initial arrow color
    this.tui.setFocus(this.promptInput);
    this.tui.start();
    // Discover reasoning capabilities in background (non-blocking)
    void this.refreshReasoningCapability();

    if (this.startupResume === "picker") {
      await this.cmdResume("");
    } else if (this.startupResume) {
      await this.applyResumeSession(this.startupResume.sessionId);
    }
  }

  // ?? Mode cycling ?????????????????????????????????????????????????????????

  private cycleMode(dir: 1 | -1): void {
    if (this.isRunning) return;
    const modes: Mode[] = ["AGENT", "EXPLORE", "PLAN", "DEBUG"];
    const prev = this.mode;
    const idx = modes.indexOf(this.mode);
    this.mode = modes[((idx + dir) + modes.length) % modes.length]!;
    setCurrentMode(this.mode);
    this.contextBar.update({ mode: this.mode });
    this.syncModeColor();

    const modeLine = `${GUTTER}${A.fg(MODE_COLORS[prev] ?? 34, prev)}${MODE_ARROW}${A.fg(MODE_COLORS[this.mode] ?? 34, this.mode)}`;
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
        const baseUrl = (config.providers as Record<string, { baseUrl?: string }>)?.["ollama"]?.baseUrl ?? "https://ollama.com";
        const apiKey  = (config.providers as Record<string, { apiKey?: string }>)?.["ollama"]?.apiKey;
        this.reasoningCapability = await discoverOllamaReasoning(baseUrl, modelName, apiKey);

        const explicitMaxOutput = await discoverOllamaMaxOutputTokens(baseUrl, modelName, apiKey);
        if (explicitMaxOutput !== undefined && explicitMaxOutput !== config.maxOutputTokens) {
          config.maxOutputTokens = explicitMaxOutput;
          await saveConfig(config);
        }
      } else {
        this.reasoningCapability = await this.reasoningCapabilityForProvider(providerName);
        if (!PROVIDER_REASONING_STYLE[providerName]) {
          const pc = (config.providers as Record<string, { type?: string; baseUrl?: string; apiKey?: string }>)[providerName];
          const pt = pc?.type as "openai-compatible" | "anthropic-compatible" | undefined;
          if (pt && pc?.baseUrl && pc?.apiKey && config.defaultModel) {
            const mn = config.defaultModel.includes("/") ? config.defaultModel.split("/").slice(1).join("/") : config.defaultModel;
            try { this.reasoningCapability = await probeReasoningSupport(pt, pc.baseUrl, pc.apiKey, mn); } catch {}
          }
        }
      }
      await this.normalizeReasoningLevel();
      this.contextBar.update({ reasoningLevel: this.reasoningDisplayLabel() });
      this.tui.requestRender();
    } catch {
      // Keep default binary capability if discovery fails
    }
  }

  private async reasoningCapabilityForProvider(providerName: string): Promise<ReasoningCapability> {
    let style = PROVIDER_REASONING_STYLE[providerName];
    if (!style) {
      const config = await loadConfig();
      const providerType = (config.providers as Record<string, { type?: string }>)[providerName]?.type;
      style = providerType === "anthropic-compatible" ? "budget" : "effort";
    }
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
        return "waiting for your answer?";
      case "todo_write":
        return "updating todos?";
      case "todo_read":
        return "reading todos?";
      case "task":
        return "running subagent?";
      default:
        return `running ${name}?`;
    }
  }

  // ?? Input submission ??????????????????????????????????????????????????????

  private async onSubmit(payload: PromptSubmitPayload): Promise<void> {
    const input = payload.displayMessage.trim();
    if (!input) return;

    if (input.startsWith("/")) {
      await this.handleSlash(payload.apiText.trim());
      this.tui.requestRender();
      return;
    }

    await this.runTurn(payload);
  }

  // ?? Agent turn ????????????????????????????????????????????????????????????

  private async runTurn(payload: PromptSubmitPayload): Promise<void> {
    const userMessage = payload.apiText;
    const displayMessage = payload.displayMessage;
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
    this.toolsRanThisTurn = false;
    this.modeChangeText = null;

    this.addSectionGap();
    this.addChatLine(`${A.fg(36, this.userName)}`);
    this.addChatLine(`${displayMessage}`);
    this.addSectionGap();

    this.streamingRaw = "";
    this.streamingText = null;
    this.thinkingRaw = "";
    this.thinkingText = null;
    this.thinkingOpen = false;
    this.resetLiveMetrics();
    this.loop.setImages(payload.orderedImages.map((i) => i.uri));
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
        this.setBusyStatus("thinking?", "Processing..");
      },
      onToken: (text) => {
        if (this.toolsRanThisTurn) {
          this.setBusyStatus("responding?", "Wrapping up...");
        } else {
          this.setBusyStatus("responding?");
        }
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
        this.setBusyStatus("thinking?", "Processing..");
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
        this.setBusyStatus(`consulting ${short}?`);
        this.addChatLine(`${clr.dim(`[advisor ? consulting ${short}?]`)}`);
        this.tui.requestRender();
      },
      onAdvisorToken: (_text) => { /* buffered */ },
      onAdvisorEnd: (summary) => {
        const raw = summary.trim();
        const oneliner = raw.split(/[.!?\n]/)[0]?.trim() ?? raw;
        const truncated = oneliner.length > 80 ? oneliner.slice(0, 77) + "?" : oneliner;
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

        this.toolsRanThisTurn = true;

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
        this.setBusyStatus(name === "question" ? "responding?" : "waiting for model?");
        this.updateLiveMetrics(result.output.length, true);
        this.tui.requestRender();
      },
      onCompacting: () => {
        this.addChatLine(`${clr.warn("?")}  ${clr.dim("compacting context?")}`);
        this.setBusyStatus("compacting context?");
        this.tui.requestRender();
      },
      onCompacted: (removedCount) => {
        this.addChatLine(
          `${clr.success("[OK]")} ${clr.dim(`compacted ? removed ${removedCount} messages`)}`
        );
        this.setBusyStatus("thinking?");
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

        if (usage.debugInstrumentationNudge) {
          this.addChatLine(
            `${clr.warn("[!]")}  ${clr.dim(usage.debugInstrumentationNudge)}`
          );
        }

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

    await this.loop.run(userMessage, this.mode, events, {
      displayMessage,
      segments: payload.segments,
    });

    // Show plan approval overlay if advisor was consulted
    if (this.pendingPlanApproval) {
      await this.showPlanApprovalOverlay();
      this.pendingPlanApproval = null;
    }

    // Auto-off suggestion: all todos complete + advisor mode ON
    await this.checkAutoOffSuggestion();
  }

  // ?? Helpers ???????????????????????????????????????????????????????????????

  private addChatLine(text: string): void {
    const avail = Math.max(4, this.terminal.columns - GUTTER_WIDTH); const lines = wrapTextWithAnsi(text, avail); for (const line of lines) { this.chat.addChild(new Text(GUTTER + line, 0, 0)); }
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
      `${clr.dim("?".repeat(40))}`,
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
        minWidth: this.overlayMin(),
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
      this.addChatLine(statusOk("Plan approved ? executing"));
    } else {
      this.addChatLine(`${clr.dim("Plan declined ? awaiting new instructions")}`);
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

  // ?? Slash autocomplete ????????????????????????????????????????????????????

  private slashCommands(): Array<{ cmd: string; hint: string }> {
    return [
      { cmd: "/advisor",  hint: "on | off | <model>  set advisor" },
      { cmd: "/model",    hint: "choose provider, API key, and model" },
      { cmd: "/vision",   hint: "on | off  toggle vision translation" },
      { cmd: "/mode",     hint: "WORK | EXPLORE | PLAN | DEBUG" },
      { cmd: "/reason",   hint: `${this.reasoningLevelsLabel()}  set reasoning level` },
      { cmd: "/new",      hint: "[name]  start new session" },
      { cmd: "/resume",   hint: "browse saved sessions" },
      { cmd: "/user",     hint: "view/update name, preferences, instructions" },
      { cmd: "/debug",    hint: "toggle debug log file" },
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

    const { show, matches } = shouldShowSlashAutocomplete(val, this.slashCommands());
    if (!show) {
      this.autocompleteText.setText("");
    } else {
      const avail = Math.max(8, this.terminal.columns - GUTTER_WIDTH);
      const lines = matches.flatMap((m) => {
        const raw = `${GUTTER}${A.fg(36, m.cmd)}  ${A.fg(90, m.hint)}`;
        return wrapTextWithAnsi(raw, avail);
      });
      this.autocompleteText.setText(lines.join("\n"));
    }
    this.tui.requestRender();
  }

  // ?? Exit stats ????????????????????????????????????????????????????????????

  private async showExitStats(): Promise<void> {
    await SessionManager.flushCurrent();

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
    this.addChatLine(`${clr.dim("?".repeat(46))}`);
    this.addChatLine(`${clr.bold("Session summary")}`);
    this.addChatLine(`${clr.dim("session")}   ${session.name}`);
    this.addChatLine(`${clr.dim("duration")}  ${dur}`);
    this.addChatLine(`${clr.dim("turns")}     ${turns}`);
    this.addChatLine(`${clr.dim("messages")}  ${msgs}`);
    this.addChatLine(`${clr.dim("model")}     ${session.model || "(none)"}`);
    this.addChatLine(`${clr.dim("?".repeat(46))}`);
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

  // ?? Slash commands ????????????????????????????????????????????????????????

  private async handleSlash(input: string): Promise<void> {
    const parts = input.slice(1).trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase() ?? "";
    const arg = parts.slice(1).join(" ").trim();

    switch (cmd) {
      case "advisor": await this.cmdAdvisor(arg); break;
      case "model":   await this.cmdModel(arg);   break;
      case "vision":  await this.cmdVision(arg);  break;
      case "mode":    this.cmdMode(arg);           break;
      case "reason":  await this.cmdReason(arg);   break;
      case "think":
        await this.cmdThink(arg);
        break;
      case "express":
        this.cmdExpress();
        break;
      case "engage":
        this.cmdEngage();
        break;
      case "user":    await this.cmdUser(arg);     break;
      case "resume":
        await this.cmdResume(arg);
        break;
      case "debug":
        setDebugEnabled(!isDebugEnabled());
        this.addChatLine(
          statusOk(`Debug logging ${isDebugEnabled() ? "enabled" : "disabled"}`)
        );
        if (isDebugEnabled()) {
          debugLog(`Debug logging enabled`);
        }
        break;
      case "new":
        await SessionManager.createNew(arg || undefined);
        this.resetTurnUiState();
        this.clearChatView();
        this.addChatLine(clr.dim("New session started"));
        this.applySessionToRenderer(SessionManager.getCurrentSession()!);
        break;
      case "clear":
        // Clear chat history (keep welcome)
        while ((this.chat as Container & { children?: Component[] }).children?.length) {
          break; // can't easily clear ? just add a separator
        }
        this.addChatLine(clr.dim("?".repeat(60)));
        break;
      case "help": this.printHelp(); break;
      case "quit":
      case "exit":
        await this.showExitStats();
        this.tui.stop();
        process.exit(0);
        break;
      default:
        this.addChatLine(`${clr.warn("[!]")} Unknown: /${cmd} ? try /help`);
    }
  }

  private modelSetupPrompt(): string {
    const state = this.modelSetup;
    if (!state) return "";

    switch (state.step) {
      case "providerName":
        return "Provider name (slug)";
      case "provider":
        return `Provider number/name [${state.currentProvider}]`;
      case "baseUrl":
        return `Endpoint URL [${state.baseUrl ?? state.provider?.modelBaseUrl ?? ""}]`;
      case "apiKey":
        return state.existing?.apiKey
          ? `API key [keep ${maskKey(state.existing.apiKey)}]`
          : "API key";
      case "modelManual":
        return "Model ID";
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
      lines.push(this.setupSectionRule());
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
          const icon = entry.valid ? clr.success("[OK]") : clr.error("[FAIL]");
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
      lines.push(clr.dim("?/?: Navigate  Enter: Select  Esc: Cancel"));
    } else if (state.step === "baseUrl") {
      lines.push(clr.bold("MODEL SETUP"));
      lines.push(this.setupSectionRule());
      lines.push("");
      lines.push(`${state.provider?.label ?? "Provider"} endpoint`);
      lines.push("");
      lines.push(clr.dim("Enter a custom endpoint or press Enter to keep the default."));
    } else if (state.step === "apiKey") {
      lines.push(clr.bold("MODEL SETUP"));
      lines.push(this.setupSectionRule());
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
      lines.push(this.setupSectionRule());
      lines.push("");
      lines.push(`Discovering ${state.provider?.label ?? "provider"} models...`);
      lines.push("");
      lines.push(clr.dim("Testing connection..."));
    } else if (state.step === "model") {
      const title = state.isAdvisorMode ? "ADVISOR SETUP" : "MODEL SETUP";
      lines.push(clr.bold(title));
      lines.push(this.setupSectionRule());
      lines.push("");
      if (state.discovery) {
        const marker = state.discovery.success ? clr.success("[OK]") : clr.warn("[WARN]");
        lines.push(`${marker} ${state.discovery.message}`);
      }
      lines.push("");
      lines.push(clr.dim("  Use the overlay: ?/? navigate, Enter to select, Esc to go back."));
    } else if (state.step === "modelManual") {
      lines.push(clr.bold(state.isAdvisorMode ? "ADVISOR SETUP" : "MODEL SETUP"));
      lines.push(this.setupSectionRule());
      lines.push("");
      lines.push(clr.dim("  Enter the full model ID for this provider."));
    } else if (state.step === "reasoning") {
      const title = state.isAdvisorMode ? "ADVISOR SETUP" : "MODEL SETUP";
      lines.push(clr.bold(title));
      lines.push(this.setupSectionRule());
      lines.push("");
      lines.push(`${clr.success("[OK]")} ${state.selectedModel ?? ""}`);
      lines.push("");
      lines.push(clr.dim("  Use the overlay: ?/? navigate, Enter to select, Esc to go back."));
    }

    if (state.error) {
      lines.push("");
      lines.push(clr.error(state.error));
    }

    if (state.step === "provider") {
      this.promptInput.setSecretMode(false);
    } else if (state.step === "model" || state.step === "reasoning") {
      this.promptInput.setSecretMode(false);
    } else {
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
      this.promptInput.getEditor().setAutocompleteProvider(ImpulseRenderer.VOID_AUTOCOMPLETE);
      this.openModelSetupModelPicker();
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
    if (provider.isCustom) return "";
    return config.defaultModel?.startsWith(`${provider.key}/`)
      ? config.defaultModel
      : provider.defaultModel;
  }

  private cancelModelSetup(): void {
    this.dismissModelSetupOverlay();
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
      this.promptInput.getEditor().setAutocompleteProvider(ImpulseRenderer.VOID_AUTOCOMPLETE);
      this.openModelSetupModelPicker();
      return;
    }

    if (state.step === "modelManual") {
      const ek = this.providerKeyForSetup(state);
      if (!input) {
        state.error = "Enter a model ID (e.g. moonshot-v1-auto).";
        this.renderModelSetup();
        return;
      }
      const full = modelWithProviderPrefix(ek, input);
      void this.afterModelSelectedInSetup(full);
      return;
    }
  }

  private async finishModelSetup(
    selectedModel: string,
    reasoningLevel?: ReasoningLevel
  ): Promise<void> {
    const state = this.modelSetup;
    const provider = state?.provider;
    const apiKey = state?.apiKey;
    if (!state || !provider || !apiKey) return;
    const effectiveKey = provider.isCustom ? (state.customProviderName ?? provider.key) : provider.key;

    this.dismissModelSetupOverlay();

    // Advisor mode: only save advisorModel, don't change default provider/model
    if (state.isAdvisorMode) {
      // Save API key to providers config
      const providers = { ...(state.config.providers as Record<string, StoredProviderConfig | undefined>) };
      providers[effectiveKey] = {
        ...(state.existing ?? {}),
        apiKey,
        ...(state.baseUrl ? { baseUrl: state.baseUrl } : {}),
      ...(provider.customType ? { type: provider.customType } : {}),
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
      this.addChatLine(statusOk(`Advisor: ${selectedModel}`));
      this.tui.requestRender();
      return;
    }

    const providers = { ...(state.config.providers as Record<string, StoredProviderConfig | undefined>) };
    providers[effectiveKey] = {
      ...(state.existing ?? {}),
      apiKey,
      ...(state.baseUrl ? { baseUrl: state.baseUrl } : {}),
      ...(provider.customType ? { type: provider.customType } : {}),
    };
    state.config.providers = providers as Config["providers"];
    state.config.defaultProvider = effectiveKey;
    state.config.defaultModel = selectedModel;
    process.env[provider.envVar] = apiKey;

    await saveConfig(state.config);
    await saveHomeEnv(provider, apiKey, state.baseUrl);
    resetProviderManager();
    SessionManager.setOptions({ defaultModel: selectedModel });
    if (SessionManager.getCurrentSession()) {
      await SessionManager.update({ model: selectedModel });
    }

    this.reasoningCapability = await this.reasoningCapabilityForProvider(effectiveKey);
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
    this.addChatLine(statusOk(`Model changed to: ${selectedModel}${reasonLabel}`));
    this.tui.requestRender();
  }

  private async cmdModel(_arg: string): Promise<void> {
    if (this.isRunning) return;

    try {
      const config = await loadConfig();
      const { buildModelPickerState, parseModelPickerSelection } = await import(
        "./components/model-picker-overlay.js"
      );
      const state = await buildModelPickerState(config, {
        maxHeight: LIST_OVERLAY_MAX_HEIGHT,
      });

      if (state.configuredProviderCount === 0) {
        this.addChatLine(`  ${clr.dim("No providers configured. Configure one first in ~/.impulse/.env")}`);
        return;
      }

      state.overlay.onSelect = async (compoundId: string) => {
        this.dismissListOverlay(this.modelPickerHandle);
        this.modelPickerHandle = null;
        const parsed = parseModelPickerSelection(compoundId);
        if (!parsed) return;

        const fullModel = parsed.modelId.includes("/")
          ? parsed.modelId
          : modelWithProviderPrefix(parsed.providerKey, parsed.modelId);
        await SessionManager.update({ model: fullModel });
        this.contextBar.update({ workerModel: fullModel });
        this.addChatLine(statusOk(`Model: ${fullModel}`));
        this.tui.requestRender();
      };

      state.overlay.onCancel = () => {
        this.dismissListOverlay(this.modelPickerHandle);
        this.modelPickerHandle = null;
      };

      state.onRowsUpdated = () => this.tui.requestRender();

      this.modelPickerHandle = this.showListOverlay(state.overlay);
      await state.discover();
      this.tui.requestRender();
    } catch (e) {
      this.addChatLine(`${clr.error("[!]")} Model selector failed: ${(e as Error).message}`);
    }
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
      if (state.step !== "provider") return undefined;

      if (data === "\x1b[A") {
        state.selectedIndex = Math.max(0, state.selectedIndex - 1);
        this.renderModelSetup();
        return { consume: true };
      }
      if (data === "\x1b[B") {
        state.selectedIndex = Math.min(
          state.providers.length - 1,
          state.selectedIndex + 1
        );
        this.renderModelSetup();
        return { consume: true };
      }
      if (data === "\r") {
        const entry = state.providers[state.selectedIndex];
        if (entry) {
          void this.selectModelSetupProvider(entry.provider);
        }
        return { consume: true };
      }
      return undefined;
    };

    this.modelSetupInputListener = this.tui.addInputListener(handleModelNav);
  }

  private async cmdAdvisor(arg: string): Promise<void> {
    if (this.isRunning) return;
    const config = await loadConfig();

    // /advisor off ? toggle OFF
    if (arg === "off") {
      config.advisorModel = undefined;
      config.advisorMode = false;
      await saveConfig(config);
      this.advisorModel = undefined;
      this.contextBar.update({ advisorModel: undefined, workerModel: config.defaultModel,
        contextTokens: this.contextTokens, contextWindow: this.contextWindow, mode: this.mode });
      this.addChatLine(statusOk("Advisor mode disabled"));
      return;
    }

    // If already ON, /advisor or /advisor on toggles it OFF
    if (config.advisorMode && (arg === "" || arg === "on")) {
      config.advisorMode = false;
      await saveConfig(config);
      this.contextBar.update({ advisorModel: undefined, workerModel: config.defaultModel,
        contextTokens: this.contextTokens, contextWindow: this.contextWindow, mode: this.mode });
      this.addChatLine(statusOk("Advisor mode disabled"));
      return;
    }

    // Direct model string: /advisor openrouter/anthropic/claude-opus-4.7
    if (arg && arg !== "on") {
      config.advisorModel = arg;
      config.advisorMode = true;
      await saveConfig(config);
      this.advisorModel = arg;
      this.contextBar.update({ advisorModel: arg });
      this.addChatLine(statusOk(`Advisor: ${arg} (mode ON)`));
      return;
    }

    // /advisor or /advisor on ? activate. Check if already configured.
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
        this.promptInput.onSubmit = (p) => {
          this.promptInput.clear();
          this.promptInput.onSubmit = prev;
          const val = p.apiText;
          const answer = val.trim().toLowerCase();
          if (answer === "y" || answer === "yes") {
            // Enter configuration setup
            void this.startAdvisorSetup(config).then(resolve);
          } else {
            // Activate with current config
            config.advisorMode = true;
            void saveConfig(config).then(() => {
              this.addChatLine(
                statusOk(`Advisor mode ON ? ${modelName} via ${providerName}`)
              );
              this.tui.requestRender();
              resolve();
            });
          }
        };
      });
      return;
    }

    // Not configured ? force setup
    this.addChatLine(`${clr.bold("Advisor Mode")} ? no advisor configured. Let's set one up.`);
    await this.startAdvisorSetup(config);
  }

  /** Start advisor model setup ? show provider picker, then model list */
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

        // Scan config for custom providers not in MODEL_PROVIDERS
    const allProvs2 = config.providers as Record<string, { apiKey?: string; baseUrl?: string; type?: string }>;
    for (const [key, stored] of Object.entries(allProvs2)) {
      if (MODEL_PROVIDERS.some(p => p.key === key)) continue;
      if (!stored?.apiKey) continue;
      const cp2: ModelProviderOption = {
        key,
        label: `Custom: ${key}${stored.type ? ` (${stored.type === "anthropic-compatible" ? "Anthropic" : "OpenAI"})` : ""}`,
        envVar: "",
        defaultModel: config.defaultModel ?? "",
        modelBaseUrl: stored.baseUrl ?? "",
        ...(stored.baseUrl ? { defaultBaseUrl: stored.baseUrl } : {}),
        needsBaseUrl: false,
        isCustom: false,
        ...(stored.type ? { customType: stored.type as "openai-compatible" | "anthropic-compatible" } : {}),
      };
      configured.push({ provider: cp2, configured: true, valid: true, keyPreview: maskKey(stored.apiKey) });
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

  private async cmdVision(arg: string): Promise<void> {
    const config = await loadConfig();
    if (!arg || arg === "on") {
      if (config.visionModel) {
        config.visionMode = true;
        await saveConfig(config);
        this.addChatLine(
          statusOk(
            `Vision mode ON ? ${config.visionModel.split("/").pop() ?? config.visionModel}`
          )
        );
      } else {
        this.addChatLine(`${clr.warn("!")} No vision model configured. Use /model to set up a vision-capable model.`);
      }
      return;
    }
    if (arg === "off") {
      config.visionMode = false;
      await saveConfig(config);
      this.addChatLine(statusOk("Vision mode OFF"));
      return;
    }
    this.addChatLine(`  vision: ${config.visionMode ? "on" : "off"}  |  options: on | off`);
  }

  private cmdMode(arg: string): void {
    const modes: Mode[] = ["EXPLORE", "PLAN", "DEBUG"];
    if (!arg) {
      this.addChatLine(`  mode: ${this.mode}  |  options: ${modes.join(" | ")}`);
      return;
    }
    const m = arg.toUpperCase() as Mode;
    if (modes.includes(m)) {
      const prev = this.mode;
      this.mode = m;
      setCurrentMode(m);
      this.contextBar.update({ mode: m });
      this.syncModeColor();
      this.addChatLine(`  ${A.fg(MODE_COLORS[prev] ?? 34, prev)}${MODE_ARROW}${A.fg(MODE_COLORS[m] ?? 34, m)}`);
    } else {
      this.addChatLine(`  ${clr.error("?")} Unknown mode. Options: ${modes.join(", ")}`);
    }
  }

  private async cmdThink(arg: string): Promise<void> {
    if (!arg) {
      const next = this.reasoningLevel === "off" ? "medium" : "off";
      await this.setReasoningLevel(next);
      this.addChatLine(`  thinking: ${this.reasoningDisplayLabel(next)}`);
      return;
    }
    await this.cmdReason(arg);
  }

  private cmdExpress(): void {
    const { enabled, needsWarning } = toggleExpress();
    if (enabled && needsWarning) {
      acknowledgeExpress();
      this.addChatLine(`  ${clr.warn("!")} Express mode ON ? all tool permissions auto-approved this session`);
    } else {
      this.addChatLine(`  express: ${enabled ? "on" : "off"}`);
    }
  }

  private cmdEngage(): void {
    this.engageMode = !this.engageMode;
    if (this.engageMode) {
      if (!isExpressMode()) {
        const { needsWarning } = toggleExpress();
        if (needsWarning) acknowledgeExpress();
      }
      this.mode = "AGENT";
      setCurrentMode("AGENT");
      this.contextBar.update({ mode: "AGENT" });
      this.syncModeColor();
      this.addChatLine(`  engage: on  (AGENT + express)`);
    } else {
      this.addChatLine(`  engage: off`);
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
      this.addChatLine(`  ${clr.error("[!]")} Valid levels: ${this.reasoningLevelsLabel()}`);
      return;
    }
    await this.setReasoningLevel(level);
  }

  private async cmdUser(_arg: string): Promise<void> {
    if (this.isRunning) return;

    const config = await loadConfig();
    const overlay = new ProfileOverlay({ profile: config.userProfile });

    overlay.onEdit = async () => {
      this.profileOverlayHandle?.hide();
      this.profileOverlayHandle = null;
      this.tui.stop();
      const { runOnboarding } = await import("../index.js");
      await runOnboarding();
      const newConfig = await loadConfig();
      this.userName = newConfig.userProfile?.name || "you";
      this.tui.start();
      this.tui.setFocus(this.promptInput);
      this.addChatLine(statusOk("Profile updated"));
      this.tui.requestRender();
    };

    overlay.onCancel = () => {
      this.profileOverlayHandle?.hide();
      this.profileOverlayHandle = null;
      this.tui.setFocus(this.promptInput);
      this.tui.requestRender();
    };

    this.profileOverlayHandle = this.tui.showOverlay(overlay, {
      anchor: "bottom-center",
      offsetY: -4,
      width: "100%",
      minWidth: this.overlayMin(),
      maxHeight: 22,
      margin: this.listOverlayMargin(),
    });
    this.profileOverlayHandle.focus();
    this.tui.requestRender();
  }

  private clearChatView(): void {
    const children = (this.chat as Container & { children: Component[] }).children;
    while (children.length > this.welcomeChildCount) {
      children.pop();
    }
    this.hasTrailingGap = false;
    this.modeChangeText = null;
    this.lastHeaderLineTitle = null;
  }

  private resetTurnUiState(): void {
    this.toolBlocks.clear();
    this.streamingRaw = "";
    this.streamingText = null;
    this.thinkingRaw = "";
    this.thinkingText = null;
    this.thinkingOpen = false;
  }

  private applySessionToRenderer(session: import("../session/store.js").Session): void {
    const mode = normalizeMode(session.mode) as Mode;
    this.mode = mode;
    setCurrentMode(mode);
    this.syncModeColor();

    if (session.model) {
      this.contextBar.update({ workerModel: session.model });
    }
    if (session.context_window) {
      this.contextWindow = session.context_window;
    }
    this.contextTokens = this.estimateCurrentSessionTokens();
    this.contextBar.update({
      mode: this.mode,
      contextTokens: this.contextTokens,
      contextWindow: this.contextWindow,
      ...(session.model ? { workerModel: session.model } : {}),
    });
  }

  private showSessionRestored(session: import("../session/store.js").Session): void {
    const title = session.headerTitle ?? session.name;
    this.addChatLine(clr.dim(`${GUTTER}${clr.bold("impulse")} ${clr.dim("|")} ${title}`));
    this.addChatLine(clr.dim("Session restored"));
    this.addSectionGap();
  }

  private async applyResumeSession(sessionID: string): Promise<void> {
    try {
      const session = await SessionManager.load(sessionID);
      this.resetTurnUiState();
      this.clearChatView();
      this.applySessionToRenderer(session);
      this.showSessionRestored(session);
      this.tui.requestRender();
    } catch (e) {
      this.addChatLine(`${clr.error("[!]")} Failed to load session: ${(e as Error).message}`);
    }
  }

  private async cmdResume(arg: string): Promise<void> {
    if (arg) {
      await this.applyResumeSession(arg);
      return;
    }

    const allSessions = await SessionManager.listSessions();
    const sessions = allSessions.filter(sessionHasResumeableContent);
    if (sessions.length === 0) {
      this.addChatLine(
        `  ${clr.dim("No sessions with messages for this project. Start a conversation or use a saved session id.")}`
      );
      return;
    }

    const config = await loadConfig();
    const overlay = new SessionPickerOverlay(sessions, {
      maxHeight: LIST_OVERLAY_MAX_HEIGHT,
      defaultModel: config.defaultModel,
    });
    overlay.onSelect = async (sessionID: string) => {
      this.dismissListOverlay(this.sessionPickerHandle);
      this.sessionPickerHandle = null;
      await this.applyResumeSession(sessionID);
    };
    overlay.onCancel = () => {
      this.dismissListOverlay(this.sessionPickerHandle);
      this.sessionPickerHandle = null;
    };

    this.sessionPickerHandle = this.showListOverlay(overlay);
    this.tui.requestRender();
  }

  private printHelp(): void {
    const reasonLevels = this.reasoningLevelsLabel();
    const rule = dimRuleIndented(this.terminalCols(), 2);
    const h = [
      "",
      `  ${clr.bold("Commands")}`,
      rule,
      `  ${clr.tool("/advisor on")}      ${clr.dim("Set advisor model")}`,
      `  ${clr.tool("/advisor off")}     ${clr.dim("Disable advisor")}`,
      `  ${clr.tool("/advisor <model>")} ${clr.dim("Set advisor directly")}`,
      `  ${clr.tool("/model")}            ${clr.dim("Browse and switch models")}`,
      `  ${clr.tool("/mode <MODE>")}     ${clr.dim("EXPLORE | PLAN | DEBUG")}`,
      `  ${clr.tool("/reason <level>")} ${clr.dim(reasonLevels)}`,
      `  ${clr.tool("/new [name]")}      ${clr.dim("Start new session")}`,
      `  ${clr.tool("/resume")}         ${clr.dim("Browse saved sessions")}`,
      `  ${clr.tool("/user")}            ${clr.dim("View/update profile & preferences")}`,
      `  ${clr.tool("/debug")}           ${clr.dim("Toggle session debug log file (not DEBUG mode)")}`,
      `  ${clr.tool("/help ")}${clr.dim("This message")}`,
      `  ${clr.tool("/exit ")}${clr.dim("Quit")}`,
      "",
      `  ${clr.bold("Keyboard")}`,
      rule,
      `  ${clr.dim("Tab")}              ${clr.dim("Cycle mode (DEBUG = evidence-first debugging)")}`,
      `  ${clr.dim("Shift+Tab")}        ${clr.dim(`Cycle reasoning level (${reasonLevels})`)}`,
      `  ${clr.dim("Ctrl+C")}           ${clr.dim("Abort current turn")}`,
      `  ${clr.dim("Ctrl+D")}           ${clr.dim("Exit")}`,
      "",
    ];
    for (const line of h) this.addChatLine(line);
  }
}
