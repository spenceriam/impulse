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
  wrapTextWithAnsi,
  type Component,
  type OverlayHandle,
} from "@mariozechner/pi-tui";
import type { EditorTheme } from "@mariozechner/pi-tui";
import {
  PromptInput,
  resolveSubmitPayloadAfterPathAttach,
  userTranscriptText,
  type PromptSubmitPayload,
} from "./prompt-input.js";
import { shouldTreatAsSlashCommand } from "./image-paths.js";
import {
  completeSlashCommandTab,
  isSlashCommandInput,
  shouldShowSlashAutocomplete,
  type SlashCompleteCycle,
  type SlashCommandEntry,
} from "./slash-autocomplete.js";
import { buildSlashCommandList } from "./slash-commands.js";
import { setAtAutocomplete } from "./at-autocomplete.js";
import { WelcomeHintBlock } from "./components/welcome-hint-block.js";
import {
  GUTTER,
  GUTTER_WIDTH,
  gutterContent,
  gutterSeparator,
  wrapGutterLines,
} from "./gutter.js";
import {
  formatLogoLine,
  formatWelcomeMeta,
  IMPULSE_GEN_TINY_LOGO,
  shouldUseAsciiLogo,
  welcomeLogoPrefix,
  welcomeMetaText,
  welcomeSublinePrefix,
} from "./welcome-banner.js";
import {
  BUSY_COMPACTING,
  BUSY_PROCESSING,
  BUSY_WORKING,
  busyPhraseUsesDimBase,
  busyStatusOverridesFixedPhrase,
  resolveBusyPhrase,
  FIXED_BUSY_PHRASES,
} from "./busy-status.js";
import { dimRuleIndented } from "./format-helpers.js";

/** pi-tui maxHeight for session/model list overlays */
const LIST_OVERLAY_MAX_HEIGHT = 18;
import { overlayMinWidth } from "./layout.js";
import { overlayMaxHeightForContent, overlayViewportMaxHeight } from "./overlay-height.js";
import { PromptHistory } from "./prompt-history.js";
import {
  isAllowAllBypass,
  resetAllowAllBypass,
  setAllowAllBypass,
} from "../permission/index.js";
import { ContextBarComponent } from "./components/context-bar.js";
import { BottomAnchorSpacer } from "./components/bottom-anchor-spacer.js";
import {
  DIFF_REVEAL_TICK_MS,
  extractDiffLinesFromMetadata,
  isSilentUnchangedTodoWrite,
  ToolBlock,
  shouldCompactToolOutput,
} from "./components/tool-block.js";
import { TaskBatchPermissionOverlay } from "./components/task-batch-permission-overlay.js";
import type { TaskBatchDecision } from "../permission/task-batch.js";
import { MarkdownTextBlock } from "./components/markdown-text.js";
import { ShellCommandBlock } from "./components/shell-command-block.js";
import { isLoneBang, parseAtReview, parseBangCommand } from "./shell-bang.js";
import { isShellTakeoverChord } from "./shell-shortcuts.js";
import {
  abortUserShell,
  runUserShellCommand,
  writeToUserShell,
  type ShellRunResult,
} from "./user-shell.js";
import { printSessionExitMessage } from "./exit-message.js";
import { PermissionOverlay } from "./components/permission-overlay.js";
import { LoopCheckinOverlay } from "./components/loop-checkin-overlay.js";
import type { LoopCheckinChoice } from "./components/loop-checkin-overlay.js";
import { QuestionOverlay } from "./components/question-overlay.js";
import { SessionPickerOverlay } from "./components/session-picker-overlay.js";
import { ProfileOverlay } from "./components/profile-overlay.js";
import { SelectableListOverlay } from "./components/selectable-list-overlay.js";
import { PlanApprovalOverlay } from "./components/plan-approval-overlay.js";
import { AllowAllDisclaimerOverlay } from "./components/allow-all-disclaimer-overlay.js";
import { ExperimentalOverlay } from "./components/experimental-overlay.js";
import {
  SettingsOverlay,
  settingsValuesEqual,
  type SettingsValues,
} from "./components/settings-overlay.js";
import { HelpOverlay } from "./components/help-overlay.js";
import { SideOverlay } from "./components/side-overlay.js";
import {
  buildSideContextSnapshot,
  formatSideCopyMarkdown,
  parseSideSlashArgs,
  runSideChat,
} from "../agent/side-chat.js";
import type { SideExchange } from "../session/store.js";
import crypto from "crypto";
import { SHIMMER_FRAME_MS, shimmerText } from "./shimmer-text.js";
import { pickUniqueShipName } from "./starfleet-ship-names.js";
import { ThinkingBlock } from "./components/thinking-block.js";
import { filterThinkingForDisplay } from "../util/thinking-filter.js";
import { buildReplaySteps, type ReplayStep } from "./session-replay.js";
import type { Session } from "../session/store.js";
import {
  buildModelSetupRows,
  buildReasoningSetupRows,
  MANUAL_MODEL_ROW_ID,
} from "./model-setup-rows.js";
import { sessionHasResumeableContent } from "../session/session-content.js";
import { AgentLoop, type LoopEvents } from "../agent/loop.js";
import { SILENT_TOOLS } from "../tools/silent-tools.js";
import {
  load as loadConfig,
  save as saveConfig,
  isModelConfigured,
  isExperimentalAdvisorEnabled,
  isExperimentalGoalEnabled,
  isExperimentalUndoEnabled,
  type Config,
  type ReasoningLevel,
  type ThinkingDisplay,
} from "../util/config.js";
import { checkForUpdate, performUpdate, getCurrentVersion } from "../util/update-check.js";
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
import { modelSupportsVisionCached } from "../api/capabilities.js";
import { resetProviderManager } from "../api/manager.js";
import {
  MODEL_PROVIDERS,
  discoverModels,
  maskKey,
  maskKeyFull,
  modelWithProviderPrefix,
  parseProviderChoice,
  providerConfig,
  isStoredProviderConfigured,
  validateProviderName,
  saveHomeEnv,
  removeProviderFromHomeEnv,
  countConfiguredProviders,
  modelUsesProvider,
  getCachedModelInfos,
  resolveCustomProviderOption,
  type ModelDiscoveryResult,
  type ModelProviderOption,
  type StoredProviderConfig,
} from "./model-setup.js";
import {
  defaultContextWindowForModel,
  enrichModelId,
  formatContextK,
  loadModelsDevCatalog,
} from "./model-catalog.js";
import { Bus } from "../bus/index.js";
import { HeaderEvents, ModeEvents, QuestionEvents, SubagentEvents, BranchEvents } from "../bus/events.js";
import { PermissionEvents, respond, type PermissionRequest } from "../permission/index.js";
import { SessionManager } from "../session/manager.js";
import { CompactManager } from "../session/compact.js";
import { estimateSessionContextTokens } from "../session/token-estimate.js";
import { CheckpointManager } from "../session/checkpoint.js";
import { formatImpulseUiStatus } from "../session/status-events.js";
import {
  createGoalState,
  parseGoalState,
  type GoalState,
} from "../session/goal-state.js";
import { buildGoalContinuationMessage, judgeGoal } from "../agent/goal-loop.js";
import { invalidatePromptCache } from "../agent/prompts.js";
import { getRepairTelemetrySummary } from "../harness/repair-telemetry.js";
import {
  collectSessionStats,
  formatSessionStatsBlock,
} from "../session/session-stats.js";
import { writeUpdateResumeHint } from "../util/update-resume-hint.js";
import { abortCurrentBashExecution } from "../tools/bash.js";
import { rejectQuestion, resolveQuestion, type Question } from "../tools/question.js";
import { setCurrentMode } from "../tools/mode-state.js";
import {
  displayModeLabel,
  displayModeOptions,
  isDefaultMode,
  MODE_CYCLE,
  normalizeMode,
  type Mode,
} from "../constants.js";
import {
  A,
  advisorStatusLine,
  clr,
  MODE_ARROW,
  MODE_COLORS,
  modelStatusLine,
} from "./ansi-theme.js";
import { dispatchSlashCommand, type SlashDispatchHost } from "./slash-dispatch.js";
import { DEFAULT_MAX_TURN_QUEUE, TurnQueueManager } from "./turn-queue.js";
import { buildQueuePreviewText } from "./queue-preview.js";
import { copy as copyToClipboard } from "../util/clipboard.js";
import type { ContextBarState } from "./components/context-bar.js";
import type { OptionalPatch } from "../util/omit-undefined.js";
import { GitBranchWatcher } from "../git/branch-watcher.js";
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
  isAdvisorMode?: boolean;  // @deprecated use setupPurpose
  setupPurpose?: "worker" | "vision" | "advisor" | "subagent";
  selectedModel?: string;   // Model selected in "model" step, used in reasoning step
  pendingRemoveProvider?: ModelProviderOption;
  editingProvider?: boolean;
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
  /** Skip disclaimer; set via --aa / --allow-all / IMPULSE_ALLOW_ALL=1 */
  allowAllOnStartup?: boolean;
}

export class ImpulseRenderer {
  // pi-tui objects
  private terminal = new ProcessTerminal();
  private tui!: TUI;
  private readonly startupResume: ResumeStartup | null;
  private readonly allowAllOnStartup: boolean;
  private skipGoalContinuation = false;
  /** Chat children below welcome header (fixed); cleared on /new and /resume */
  private welcomeChildCount = 0;


  // Layout components
  private chat!: Container;
  private spinnerText!: Text;
  private queuePreviewText!: Text;
  private static readonly MAX_TURN_QUEUE = DEFAULT_MAX_TURN_QUEUE;
  private turnQueue = new TurnQueueManager(
    ImpulseRenderer.MAX_TURN_QUEUE,
    (payload) => this.isNonemptySubmitPayload(payload)
  );
  private shellTakeoverActive = false;
  private shellCommandRunning = false;
  private shellEscArmed = false;
  private shellEscTimer: ReturnType<typeof setTimeout> | null = null;
  private activeShellBlock: ShellCommandBlock | null = null;
  private lastShellOutput: ShellRunResult | null = null;
  private contextBar!: ContextBarComponent;
  private promptInput!: PromptInput;
  private promptHistory = new PromptHistory();
  private autocompleteText!: Text; // slash command suggestions
  private modelSetupText!: Text;
  private bottomSpacer!: BottomAnchorSpacer;
  /** Frozen top spacer line count during an active turn (prevents welcome-header flash). */
  private turnAnchorEmptyLines: number | null = null;

  // Manual turn-status spinner + render ticker
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private currentStatusPhrase = "";
  private compactStartMs = 0;

  private shimmerBusyText(message: string, dimBase = false): string {
    return shimmerText(message, dimBase);
  }

  private renderBusyLine(): void {
    if (!this.currentStatusPhrase) {
      this.spinnerText.setText("");
      return;
    }
    this.spinnerText.setText(
      gutterContent(this.shimmerBusyText(this.currentStatusPhrase, this.busyDimBase), this.terminalCols())
    );
  }

  private spinStop(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    this.currentStatusPhrase = "";
    this.spinnerText.setText("");
    this.freezeTodoBlink();
    this.tui.requestRender();
  }

  private freezeTodoBlink(): void {
    this.latestTodoBlock?.setTodoBlinkEnabled(false);
  }

  private markLatestTodoBlock(block: ToolBlock): void {
    if (this.latestTodoBlock && this.latestTodoBlock !== block) {
      this.latestTodoBlock.setTodoBlinkEnabled(false);
    }
    this.latestTodoBlock = block;
    block.setTodoBlinkEnabled(this.isRunning);
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
      this.setupSectionRule(),
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
      await this.persistSessionAdvisor(false);
      this.syncAdvisorFromConfig(await loadConfig());
      this.syncContextBar({ advisorModel: undefined });
      this.addChatLine(clr.dim("Advisor mode disabled  --  all tasks complete"));
      this.tui.requestRender();
    }
  }

  private busyDimBase = false;

  private setBusyStatus(msg: string, fixedPhrase?: string): void {
    if (
      !busyStatusOverridesFixedPhrase(msg, fixedPhrase) &&
      this.spinnerInterval &&
      this.currentStatusPhrase &&
      FIXED_BUSY_PHRASES.has(this.currentStatusPhrase)
    ) {
      return;
    }

    this.currentStatusPhrase = resolveBusyPhrase(msg, fixedPhrase);
    this.busyDimBase = busyPhraseUsesDimBase(this.currentStatusPhrase, msg);
    this.renderBusyLine();
    this.tui.requestRender();

    if (!this.spinnerInterval) {
      this.spinnerInterval = setInterval(() => {
        this.renderBusyLine();
        this.tui.requestRender();
      }, SHIMMER_FRAME_MS);
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
    this.setBusyStatus("Waiting for approval ...", "Waiting for your approval...");

    const overlay = new PermissionOverlay(request);
    overlay.onDecision = (response, opts) => {
      const permissionID = request.id;
      const resumeStatus = `running ${request.permission}?`;
      this.dismissPermissionOverlay(resumeStatus);
      respond({
        permissionID,
        response,
        ...(opts?.wildcard ? { wildcard: true } : {}),
      });
    };

    const cols = this.terminalCols();
    overlay.setMeasureTerminalWidth(cols);
    const rows = this.tui.terminal?.rows ?? this.terminal.rows ?? 24;
    const contentLines = overlay.render(cols);
    const maxHeight = overlayMaxHeightForContent(rows, contentLines.length);

    this.permissionOverlayHandle = this.showContentSizedOverlay(overlay, {
      maxHeight,
    });
    this.tui.requestRender();
  }

  private dismissTaskBatchPermissionOverlay(): void {
    this.taskBatchOverlayHandle?.hide();
    this.taskBatchOverlayHandle = null;
  }

  private dismissLoopCheckinOverlay(): void {
    this.loopCheckinOverlayHandle?.hide();
    this.loopCheckinOverlayHandle = null;
  }

  private showLoopCheckin(input: {
    reason: string;
    iteration: number;
  }): Promise<LoopCheckinChoice> {
    return new Promise((resolve) => {
      if (!this.tui) {
        resolve("continue");
        return;
      }

      this.dismissLoopCheckinOverlay();
      this.setBusyStatus("Loop check-in ...", "Waiting for your decision...");

      const overlay = new LoopCheckinOverlay(input);
      overlay.onDecision = (choice) => {
        this.dismissLoopCheckinOverlay();
        if (this.isRunning) {
          this.setBusyStatus("Thinking ...", BUSY_PROCESSING);
        }
        resolve(choice);
      };

      const cols = this.terminalCols();
      overlay.setMeasureTerminalWidth(cols);
      const rows = this.tui.terminal?.rows ?? this.terminal.rows ?? 24;
      const contentLines = overlay.render(cols);
      const maxHeight = overlayMaxHeightForContent(rows, contentLines.length);

      this.loopCheckinOverlayHandle = this.showContentSizedOverlay(overlay, {
        maxHeight,
      });
      this.tui.requestRender();
    });
  }

  private showTaskBatchPermission(count: number): Promise<TaskBatchDecision> {
    return new Promise((resolve) => {
      if (!this.tui) {
        resolve({ action: "approve" });
        return;
      }

      this.dismissTaskBatchPermissionOverlay();
      this.setBusyStatus("Waiting for approval ...", "Waiting for your approval...");

      const overlay = new TaskBatchPermissionOverlay(count);
      overlay.onDecision = (decision) => {
        this.dismissTaskBatchPermissionOverlay();
        if (this.isRunning) {
          this.setBusyStatus("Running parallel sub-agents ...", BUSY_WORKING);
        }
        resolve(decision);
      };

      const cols = this.terminalCols();
      overlay.setMeasureTerminalWidth(cols);
      const rows = this.tui.terminal?.rows ?? this.terminal.rows ?? 24;
      const contentLines = overlay.render(cols);
      const maxHeight = overlayMaxHeightForContent(rows, contentLines.length);

      this.taskBatchOverlayHandle = this.showContentSizedOverlay(overlay, {
        maxHeight,
      });
      this.tui.requestRender();
    });
  }

  private ensureDiffRevealLoop(): void {
    if (this.diffRevealInterval || !this.tui) return;

    this.diffRevealInterval = setInterval(() => {
      let anyRevealing = false;
      for (const [id, block] of this.toolBlocks) {
        if (!block.isRevealing()) continue;
        anyRevealing = true;
        if (block.tickDiffReveal()) {
          this.lastBandToolHadBody = true;
          this.toolBlocks.delete(id);
        }
      }

      if (!anyRevealing) {
        if (this.diffRevealInterval) {
          clearInterval(this.diffRevealInterval);
          this.diffRevealInterval = null;
        }
      }

      this.tui?.requestRender();
    }, DIFF_REVEAL_TICK_MS);
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
    this.setBusyStatus("Waiting for answer ...", "Waiting for your answer...");

    const overlay = new QuestionOverlay({ context, questions });
    overlay.onSubmit = (answers) => {
      this.dismissQuestionOverlay(false);
      resolveQuestion(answers);
      if (this.isRunning) {
        this.setBusyStatus("Responding ...");
      }
    };
    overlay.onAbort = () => {
      this.abortCurrentTurn();
    };

    const cols = this.terminalCols();
    overlay.setMeasureTerminalWidth?.(cols);
    const rows = this.tui.terminal?.rows ?? this.terminal.rows ?? 24;
    const maxHeight = overlayViewportMaxHeight(rows);
    overlay.setMaxHeight(maxHeight);

    this.questionOverlayHandle = this.showContentSizedOverlay(overlay, {
      maxHeight,
    });
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
    const sized = overlay as Component & {
      preferredBoxWidth?: (w: number) => number;
      setMeasureTerminalWidth?: (w: number) => void;
    };
    if (typeof sized.preferredBoxWidth === "function") {
      return this.showContentSizedOverlay(sized, { maxHeight: LIST_OVERLAY_MAX_HEIGHT });
    }
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

  private showContentSizedOverlay(
    overlay: Component & {
      handleInput?: (data: string) => void;
      preferredBoxWidth?: (w: number) => number;
      setMeasureTerminalWidth?: (w: number) => void;
    },
    opts?: { maxHeight?: number }
  ): OverlayHandle {
    const cols = this.terminalCols();
    overlay.setMeasureTerminalWidth?.(cols);
    const pref =
      typeof overlay.preferredBoxWidth === "function"
        ? overlay.preferredBoxWidth(cols)
        : this.overlayMin();
    const handle = this.tui.showOverlay(overlay, {
      anchor: "bottom-center",
      offsetY: -4,
      width: pref,
      minWidth: pref,
      maxHeight: opts?.maxHeight ?? LIST_OVERLAY_MAX_HEIGHT,
      margin: this.listOverlayMargin(),
    });
    handle.focus();
    return handle;
  }

  private showSessionPickerOverlay(
    overlay: SessionPickerOverlay
  ): OverlayHandle {
    return this.showContentSizedOverlay(overlay, {
      maxHeight: LIST_OVERLAY_MAX_HEIGHT,
    });
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

    const purpose = this.setupPurpose(state);
    if (purpose === "vision" || purpose === "advisor" || purpose === "subagent") {
      await this.finishModelSetup(selectedModel, "off");
      return;
    }

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
    const purpose = this.setupPurpose(state);
    let modelIds = state.models;
    if (purpose === "vision") {
      modelIds = modelIds.filter((id) => modelSupportsVisionCached(id));
    }
    const rows = buildModelSetupRows(
      providerKey,
      modelIds,
      state.provider?.isCustom ? { allowManual: true } : undefined
    );

    const title =
      purpose === "vision"
        ? "Select vision model"
        : purpose === "advisor"
          ? "Select advisor model"
          : purpose === "subagent"
            ? "Select subagent model"
            : "Select model";
    const overlay = new SelectableListOverlay({
      title,
      rows,
      boxSizing: "responsive",
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
    this.modelSetupOverlayHandle = this.showContentSizedOverlay(overlay, {
      maxHeight: LIST_OVERLAY_MAX_HEIGHT,
    });
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
    // Silent in chat ? title is for /resume and session management only
  }

  private clearCtrlCPending(): void {
    this.ctrlCPending = null;
    this.ctrlCPendingAt = 0;
  }

  private handleCtrlC(): void {
    if (this.modelSetup) {
      this.cancelModelSetup();
      return;
    }

    if (this.abortActiveShell()) {
      return;
    }

    const now = Date.now();

    if (this.isRunning) {
      if (
        this.ctrlCPending === "cancel" &&
        now - this.ctrlCPendingAt < ImpulseRenderer.CTRL_C_WINDOW_MS
      ) {
        this.clearCtrlCPending();
        this.abortCurrentTurn();
        return;
      }
      this.ctrlCPending = "cancel";
      this.ctrlCPendingAt = now;
      this.addChatLine(clr.dim("Hit Ctrl+C again to cancel"));
      this.tui.requestRender();
      return;
    }

    if (
      this.ctrlCPending === "exit" &&
      now - this.ctrlCPendingAt < ImpulseRenderer.CTRL_C_WINDOW_MS
    ) {
      this.clearCtrlCPending();
      void this.gracefulExit();
      return;
    }
    this.ctrlCPending = "exit";
    this.ctrlCPendingAt = now;
    this.addChatLine(clr.dim("Hit Ctrl+C again to exit"));
    this.tui.requestRender();
  }

  private abortCurrentTurn(): void {
    if (!this.isRunning) return;

    let hadTask = false;
    let lastCodename: string | undefined;

    rejectQuestion(new Error("Question cancelled by user"));
    this.dismissQuestionOverlay(false);
    abortCurrentBashExecution();
    this.closeThinking();
    this.finalizeAssistantStreamingSegment(false);

    for (const [id, block] of this.toolBlocks) {
      if (!block.isRunning()) continue;

      const toolName = block.getToolName();
      if (toolName === "task") {
        hadTask = true;
        lastCodename = this.taskCodenames.get(id);
      }

      block.setDone(
        {
          success: false,
          output:
            toolName === "task"
              ? "Sub-agent aborted by user"
              : "Cancelled by user",
        },
        block.getElapsedMs(),
        { collapsed: toolName === "task" }
      );
      this.toolBlocks.delete(id);
      this.taskCodenames.delete(id);
    }
    const codename = lastCodename;

    this.skipGoalContinuation = true;
    this.loop.abort();
    this.spinStop();
    this.isRunning = false;
    this.releaseTurnAnchor();
    if (this.speedoEnabled && this.liveTurnStartedAt > 0) {
      this.syncContextBar({
        isRunning: false,
        lastTurnMs: Date.now() - this.liveTurnStartedAt,
        tokensPerSecond: undefined,
      });
    } else {
      this.syncContextBar({ isRunning: false });
    }
    this.clearCtrlCPending();

    this.addSectionGap();
    let msg: string;
    if (hadTask && codename) msg = `${codename} sub-agent aborted`;
    else if (hadTask) msg = "sub-agent aborted";
    else msg = "turn cancelled";
    this.addChatLine(clr.dim(msg));
    this.tui.setFocus(this.promptInput);
    this.tui.requestRender();
    this.drainTurnQueue();
  }

  private isNonemptySubmitPayload(payload: PromptSubmitPayload): boolean {
    return payload.displayMessage.trim().length > 0 || payload.apiText.trim().length > 0;
  }

  private syncContextBar(patch: OptionalPatch<ContextBarState> = {}): void {
    this.contextBar.update({
      mode: this.mode,
      contextTokens: this.contextTokens,
      contextWindow: this.contextWindow,
      ...patch,
    });
  }

  private queuePreviewWidth(): number {
    return Math.max(40, process.stdout.columns ?? 80);
  }

  private buildQueuePreviewText(): string {
    const { holdDrain, editIndex } = this.turnQueue.editState;
    return buildQueuePreviewText({
      items: this.turnQueue.snapshot(),
      holdDrain,
      editIndex,
      width: this.queuePreviewWidth(),
    });
  }

  private updateQueuePreview(): void {
    if (!this.queuePreviewText) return;
    const text = this.buildQueuePreviewText();
    this.queuePreviewText.setText(text);
  }

  private enqueueTurn(payload: PromptSubmitPayload): void {
    const result = this.turnQueue.enqueue(payload);
    if (result === "empty") return;
    if (result === "full") {
      this.addChatLine(clr.warn(`Queue full (${ImpulseRenderer.MAX_TURN_QUEUE} messages)`));
      this.tui.requestRender();
      return;
    }
    this.updateQueuePreview();
    this.requestBottomAnchorRefresh();
    this.tui.requestRender();
  }

  private drainTurnQueue(): void {
    if (this.turnQueue.isHoldDrain || this.turnQueue.length === 0 || this.isRunning) return;
    if (!this.turnQueue.pruneHead()) {
      this.updateQueuePreview();
      return;
    }
    const next = this.turnQueue.shift()!;
    this.updateQueuePreview();
    const reviewQ = parseAtReview(next.displayMessage.trim());
    if (reviewQ && this.lastShellOutput) {
      void this.runShellReview(reviewQ, this.lastShellOutput);
      return;
    }
    void this.runTurn(next);
  }

  private async persistCacheReadTokens(delta: number): Promise<void> {
    const session = SessionManager.getCurrentSession();
    if (!session || delta <= 0) return;
    const prevRaw = session.metadata?.["cacheReadTokens"];
    const prev = typeof prevRaw === "number" && Number.isFinite(prevRaw) ? prevRaw : 0;
    await SessionManager.update({
      metadata: { ...(session.metadata ?? {}), cacheReadTokens: prev + delta },
    });
  }

  private async persistGoalState(): Promise<void> {
    const session = SessionManager.getCurrentSession();
    if (!session) return;
    const metadata = { ...(session.metadata ?? {}), goal: this.goalState };
    await SessionManager.update({ metadata });
  }

  private loadGoalFromSession(session: Session): void {
    this.goalState = parseGoalState(session.metadata?.["goal"]);
  }

  private goalLoopActive(): boolean {
    return (
      this.experimentalGoalEnabled &&
      this.goalState !== undefined &&
      this.goalState.status === "active"
    );
  }

  private async maybeContinueGoalLoop(): Promise<void> {
    if (this.skipGoalContinuation) {
      this.skipGoalContinuation = false;
      this.drainTurnQueue();
      return;
    }
    if (!this.goalLoopActive() || this.turnQueue.length > 0) {
      this.drainTurnQueue();
      return;
    }

    const activeGoal = this.goalState;
    if (!activeGoal) {
      this.drainTurnQueue();
      return;
    }

    const cfg = await loadConfig();
    const judgeModel = cfg.subagentModel?.trim() || cfg.defaultModel?.trim();
    const result = await judgeGoal(
      activeGoal,
      this.lastAssistantTurnText,
      judgeModel
    );

    if (result.verdict === "done") {
      this.goalState = {
        ...activeGoal,
        status: "done",
        lastJudgeReason: result.reason,
      };
      await this.persistGoalState();
      void this.emitStatusEvent(`Goal achieved: ${result.reason}`);
      this.drainTurnQueue();
      return;
    }

    const nextTurns = activeGoal.turnsUsed + 1;
    const updatedGoal: GoalState = {
      ...activeGoal,
      turnsUsed: nextTurns,
      lastJudgeReason: result.reason,
    };
    this.goalState = updatedGoal;

    if (nextTurns >= activeGoal.maxTurns) {
      this.goalState = { ...updatedGoal, status: "paused" };
      await this.persistGoalState();
      void this.emitStatusEvent(
        `Goal paused — ${nextTurns}/${activeGoal.maxTurns} turns. /goal resume`
      );
      this.drainTurnQueue();
      return;
    }

    await this.persistGoalState();
    const continuation = buildGoalContinuationMessage(updatedGoal);
    void this.runTurn({
      apiText: continuation,
      displayMessage: continuation,
      orderedImages: [],
      segments: [],
    });
  }

  private beginQueueEdit(): boolean {
    if (!this.turnQueue.beginEdit()) return false;
    const editing = this.turnQueue.editingPayload();
    if (editing) this.promptInput.setText(editing.displayMessage);
    this.updateQueuePreview();
    this.tui.requestRender();
    return true;
  }

  private cancelQueueEdit(): void {
    this.turnQueue.cancelEdit();
    this.promptInput.clear();
    this.updateQueuePreview();
    this.tui.requestRender();
  }

  private commitQueueEdit(payload: PromptSubmitPayload): void {
    this.turnQueue.commitEdit(payload);
    this.promptInput.clear();
    this.updateQueuePreview();
    this.tui.requestRender();
  }

  private abortActiveShell(): boolean {
    if (this.shellCommandRunning) {
      abortUserShell();
      this.shellCommandRunning = false;
      this.shellTakeoverActive = false;
      this.activeShellBlock?.setCancelled();
      this.activeShellBlock = null;
      this.shellEscArmed = false;
      if (this.shellEscTimer) clearTimeout(this.shellEscTimer);
      this.addChatLine(clr.dim("Shell command cancelled"));
      this.tui.requestRender();
      return true;
    }
    return false;
  }

  private handleShellEscape(): boolean {
    if (!this.shellCommandRunning) return false;

    if (!this.shellEscArmed) {
      this.shellEscArmed = true;
      this.addChatLine(clr.dim("Press Esc again to cancel shell command"));
      if (this.shellEscTimer) clearTimeout(this.shellEscTimer);
      this.shellEscTimer = setTimeout(() => {
        this.shellEscArmed = false;
      }, 2500);
      this.tui.requestRender();
      return true;
    }
    this.shellEscArmed = false;
    return this.abortActiveShell();
  }

  private async runBangCommand(command: string): Promise<void> {
    this.addSectionGap();
    const block = new ShellCommandBlock(command);
    this.activeShellBlock = block;
    this.chat.addChild(block);
    this.hasTrailingGap = false;
    this.shellCommandRunning = true;
    this.shellTakeoverActive = false;
    this.requestBottomAnchorRefresh();

    const interactive = /\bsudo\b/.test(command) || command.includes("ssh");
    if (interactive) {
      block.setInteractiveHint(true);
    }

    const result = await runUserShellCommand({
      command,
      cols: this.terminalCols(),
      rows: Math.max(8, (this.tui.terminal?.rows ?? 24) - 12),
      onData: (chunk) => {
        block.appendOutput(chunk);
        this.requestBottomAnchorRefresh();
      },
      forceInteractive: interactive,
    });

    this.shellCommandRunning = false;
    this.shellTakeoverActive = false;
    block.setInteractiveHint(false);
    block.setTakeoverActive(false);
    block.setDone(result.exitCode, result.durationMs);
    this.lastShellOutput = result;
    this.activeShellBlock = null;
    this.requestBottomAnchorRefresh();
  }

  // Streaming state: current assistant text block (updated in-place)
  private streamingText: MarkdownTextBlock | null = null;
  private streamingRaw = "";
  private thinkingText: ThinkingBlock | null = null;
  private thinkingRaw = "";
  private thinkingOpen = false;
  private thinkingStartedAt = 0;
  /** Cumulative reasoning time this assistant stream (mirrors loop thinkingDurationMs). */
  private thinkingElapsedMs = 0;
  /** Session-local: keep new thinking blocks expanded until /hide-think. */
  private hasTrailingGap = false;
  /** True when the last chat-band row was a tool block (cluster consecutive tools). */
  private lastBandWasTool = false;
  private lastBandToolHadBody = false;
  private lastToolGapSpacer: Spacer | null = null;
  private preToolSpacing: {
    lastBandWasTool: boolean;
    lastBandToolHadBody: boolean;
    hasTrailingGap: boolean;
  } | null = null;
  /** One yellow impulse header per user message turn (not per tool continuation). */
  private turnShowsImpulseHeader = false;
  private toolBlocks = new Map<string, ToolBlock>();
  private latestTodoBlock: ToolBlock | null = null;
  private taskCodenames = new Map<string, string>();
  private diffRevealInterval: ReturnType<typeof setInterval> | null = null;
  private taskBatchOverlayHandle: OverlayHandle | null = null;
  private ctrlCPending: "cancel" | "exit" | null = null;
  private ctrlCPendingAt = 0;
  private static readonly CTRL_C_WINDOW_MS = 2000;
  private permissionQueue: PermissionRequest[] = [];
  private activePermission: PermissionRequest | null = null;
  private permissionOverlayHandle: OverlayHandle | null = null;
  private loopCheckinOverlayHandle: OverlayHandle | null = null;
  private questionOverlayHandle: OverlayHandle | null = null;
  private sessionPickerHandle: OverlayHandle | null = null;
  private modelPickerHandle: OverlayHandle | null = null;
  private modelSetupOverlayHandle: OverlayHandle | null = null;
  private profileOverlayHandle: OverlayHandle | null = null;
  private busUnsubscribe: (() => void) | null = null;
  private branchWatcher: GitBranchWatcher | null = null;
  private liveTurnStartedAt = 0;
  private liveGeneratedChars = 0;
  private lastLiveMetricsAt = 0;

  // Agent + state
  private loop = new AgentLoop();
  private mode: Mode = "AGENT";
  private contextTokens = 0;
  private contextWindow = 128_000;
  private advisorModel: string | undefined;
  private visionModel: string | undefined;
  private helpOverlayHandle: OverlayHandle | null = null;
  private sideOverlayHandle: OverlayHandle | null = null;
  private sideOverlay: SideOverlay | null = null;
  private sideInputCleanup: (() => void) | null = null;
  private sideAbortController: AbortController | null = null;
  private sideStreamActive = false;
  private currentSideExchangeId: string | null = null;
  private reasoningLevel: ReasoningLevel = "medium";
  private reasoningCapability: ReasoningCapability = { supported: true, style: "binary", levels: ["off", "medium"] };
  private isRunning = false;
  private allowAllDisclaimerHandle: OverlayHandle | null = null;
  private modelSetup: ModelSetupState | null = null;
  private planApprovalOverlayHandle: OverlayHandle | null = null;
  private planApprovalInputCleanup: (() => void) | null = null;
  private helpInputCleanup: (() => void) | null = null;
  private experimentalOverlayHandle: OverlayHandle | null = null;
  private settingsOverlayHandle: OverlayHandle | null = null;
  private settingsInputCleanup: (() => void) | null = null;
  private experimentalAdvisorEnabled = false;
  private experimentalUndoEnabled = false;
  private experimentalGoalEnabled = false;
  private thinkingDisplay: ThinkingDisplay = "summary";
  private compactToolOutputEnabled = true;
  private streamRenderScheduled = false;
  private streamBusyPhraseSet = false;
  private lastExpandableTool: ToolBlock | null = null;
  private lastExpandableThinking: ThinkingBlock | null = null;
  private goalState: GoalState | undefined;
  private lastAssistantTurnText = "";
  /** Accumulates finalized assistant markdown segments for /copy across a turn. */
  private currentTurnAssistantText = "";
  private responsePreference = "concise";
  /** Session-local turn speed display on context bar (/speedo); not persisted. */
  private speedoEnabled = false;
  private slashTabCycle: SlashCompleteCycle | null = null;
  private userName = "you"; // User's display name (loaded from config)
  private modeChangeText: Text | null = null; // Track mode change line for in-place updates

  constructor(options?: ImpulseRendererOptions) {
    this.startupResume = options?.resume ?? null;
    this.allowAllOnStartup = options?.allowAllOnStartup ?? false;
  }

  /** Submit a plain-text message after the TUI is running (CLI initial arg). */
  async submitMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.promptInput.setText(trimmed);
    await this.onSubmit(this.promptInput.getSubmitPayload());
  }

  async start(): Promise<void> {
    let config = await loadConfig();
    this.mode = normalizeMode(config.defaultMode) as Mode;
    this.experimentalAdvisorEnabled = isExperimentalAdvisorEnabled(config);
    this.experimentalUndoEnabled = isExperimentalUndoEnabled(config);
    this.experimentalGoalEnabled = isExperimentalGoalEnabled(config);
    this.reasoningLevel = config.reasoningLevel ?? (config.thinking ? "medium" : "off");
    this.reasoningCapability = await this.reasoningCapabilityForProvider(config.defaultProvider);
    this.userName = config.userProfile?.name || "you";
    this.syncDisplaySettingsFromConfig(config);
    await this.normalizeReasoningLevel();

    setCurrentMode(this.mode);

    SessionManager.setOptions({
      defaultModel: config.defaultModel ?? "",
      defaultMode: this.mode,
      initialContextWindow: this.contextWindow,
    });

    if (!SessionManager.getCurrentSession()) {
      await SessionManager.createNew();
      const sess = SessionManager.getCurrentSession();
      if (sess && config.defaultModel?.trim()) {
        await SessionManager.update({ model: config.defaultModel });
      }
    }

    config = await loadConfig();
    this.syncAdvisorFromConfig(config);

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
        return;
      }

      if (event.type === ModeEvents.Changed.name) {
        const { mode } = event.properties as { mode: string };
        const next = normalizeMode(mode) as Mode;
        const prev = this.mode;
        this.applyModeChange(next, { prev, transition: "chat" });
        this.tui.requestRender();
        return;
      }

      if (event.type === SubagentEvents.Progress.name) {
        const payload = event.properties as {
          type: "text" | "tool" | "thinking" | "status";
          content: string;
          durationMs?: number;
          parentToolCallId: string;
        };
        const block = this.toolBlocks.get(payload.parentToolCallId);
        if (block) {
          block.appendSubagentLine({
            type: payload.type,
            content: payload.content,
            ...(payload.durationMs !== undefined ? { durationMs: payload.durationMs } : {}),
          });
          this.tui.requestRender();
        }
      }

      if (event.type === BranchEvents.Changed.name) {
        this.contextBar.invalidate();
        this.tui.requestRender();
        return;
      }
    });

    // 0. Bottom anchor spacer ? pushes content down so contextBar stays at terminal bottom
    this.bottomSpacer = new BottomAnchorSpacer(
      this.tui,
      () => this.getContentHeight(),
      () => this.turnAnchorEmptyLines
    );
    this.tui.addChild(this.bottomSpacer);

    // 1. Chat history ? grows as turns are added
    this.chat = new Container();
    this.tui.addChild(this.chat);

    // Welcome header
    const version = (packageJson as { version: string }).version;
    this.chat.addChild(new Spacer(1));
    if (shouldUseAsciiLogo(this.terminal.columns)) {
      for (const line of IMPULSE_GEN_TINY_LOGO) {
        this.chat.addChild(new Text(`${welcomeLogoPrefix()}${formatLogoLine(line)}`, 0, 0));
      }
      this.chat.addChild(new Text(`${welcomeSublinePrefix()}${formatWelcomeMeta(version)}`, 0, 0));
    } else {
      this.chat.addChild(
        new Text(
          `${welcomeSublinePrefix()}${clr.bold("impulse")} ${clr.dim("|")} ${A.reset}${welcomeMetaText(version)}`,
          0,
          0
        )
      );
    }
    this.chat.addChild(new WelcomeHintBlock());
    this.chat.addChild(new Spacer(1));
    this.welcomeChildCount = (this.chat as Container & { children: Component[] }).children.length;

    // 2. Spacer + turn-status line above the prompt
    this.tui.addChild(new Spacer(1));
    this.spinnerText = new Text("", 0, 0);
    this.tui.addChild(this.spinnerText);

    this.queuePreviewText = new Text("", 0, 0);
    this.tui.addChild(this.queuePreviewText);

    // 3. Separator ABOVE input
    this.tui.addChild(new SeparatorLine());

    this.modelSetupText = new Text("", 0, 0);
    this.tui.addChild(this.modelSetupText);

    // Slash command autocomplete ? shown only when input starts with /
    this.autocompleteText = new Text("", 0, 0);
    this.tui.addChild(this.autocompleteText);

    // 4. Prompt input (just ? , no mode label)
    this.promptInput = new PromptInput(this.tui, EDITOR_THEME);
    this.restorePromptAutocomplete();
    this.promptInput.onSubmit = (payload) => {
      this.autocompleteText.setText("");
      if (this.modelSetup) {
        void this.handleModelSetupSubmit(payload.apiText);
      } else {
        void this.onSubmit(payload);
      }
    };
    this.promptInput.onArrowUp = () => {
      if (this.modelSetup) return;
      if (this.isRunning && this.turnQueue.length > 0 && this.promptInput.getText().trim() === "") {
        this.beginQueueEdit();
        return;
      }
      if (this.isRunning) return;
      const prev = this.promptHistory.previous();
      if (prev !== null) this.promptInput.setText(prev);
    };
    this.promptInput.onArrowDown = () => {
      if (this.modelSetup) return;
      this.promptHistory.resetIndex();
      this.promptInput.clear();
    };
    this.promptInput.onTabForward = () => {
      if (this.modelSetup) return;
      const val = this.promptInput.getText();
      if (isSlashCommandInput(val)) {
        const { text, nextCycle } = completeSlashCommandTab(
          val,
          this.slashCommands(),
          this.slashTabCycle
        );
        this.slashTabCycle = nextCycle;
        if (text !== null) {
          this.promptInput.setText(text);
          this.updateAutocomplete(text);
          this.tui.requestRender();
        }
        return;
      }
      this.cycleMode(1);
    };
    this.promptInput.onTabBackward = () => {
      if (this.modelSetup) return;
      if (isSlashCommandInput(this.promptInput.getText())) return;
      void this.cycleReasoning();
    };
    this.promptInput.onAbort = () => {
      this.handleCtrlC();
    };
    this.promptInput.onExit = () => {
      void this.gracefulExit();
    };
    this.promptInput.onEscape = () => {
      if (this.turnQueue.isHoldDrain) {
        this.cancelQueueEdit();
        return;
      }
      if (
        !this.isRunning &&
        this.turnQueue.length > 0 &&
        this.promptInput.getText().trim() === ""
      ) {
        this.turnQueue.clearHead();
        this.updateQueuePreview();
        void this.emitStatusEvent("Queue head cleared");
        this.tui.requestRender();
        return;
      }
      if (this.handleShellEscape()) return;

      if (this.sideOverlayHandle) {
        this.dismissSideOverlay();
        return;
      }

      if (this.helpOverlayHandle) {
        this.dismissHelpOverlay();
        return;
      }

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
          state.step = "provider";
          delete state.customProviderName;
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
    this.promptInput.onChange = (val) => {
      this.resetSlashTabCycleIfNeeded(val);
      this.updateAutocomplete(val);
    };
    this.tui.addChild(this.promptInput);

    // 5. Separator BELOW input
    this.tui.addChild(new SeparatorLine());

    // 6. Context bar ? sticky absolute bottom
    this.contextBar = new ContextBarComponent({
      workerModel: config.defaultModel,
      impulseVersion: (packageJson as { version: string }).version,
      contextTokens: this.contextTokens,
      contextWindow: this.contextWindow,
      mode: this.mode,
      reasoningLevel: this.reasoningDisplayLabel(),
      ...(this.advisorModel ? { advisorModel: this.advisorModel } : {}),
      showAdvisorInBar: this.experimentalAdvisorEnabled && (config.advisorMode ?? false),
    });
    this.syncVisionFromConfig(config);
    this.syncSpeedoUi();
    this.tui.addChild(this.contextBar);

    // Start git branch filesystem watcher to catch external branch switches
    this.branchWatcher = new GitBranchWatcher(process.cwd());
    this.branchWatcher.start();

    // ?? Start TUI (takes over terminal raw mode) ??????????????????????????
    this.syncModeColor(); // set initial arrow color
    this.tui.setFocus(this.promptInput);
    resetAllowAllBypass();
    if (this.allowAllOnStartup) {
      setAllowAllBypass(true);
    }
    this.syncAllowAllBypassUi();

    this.tui.addInputListener((data) => {
      if (this.shellTakeoverActive && this.shellCommandRunning) {
        if (data === "\r") {
          writeToUserShell("\n");
          return { consume: true };
        }
        if (data === "\x7f" || data === "\b") {
          writeToUserShell("\b");
          return { consume: true };
        }
        if (data.length === 1 && data >= " " && data !== "\x1b") {
          writeToUserShell(data);
          return { consume: true };
        }
      }
      if (
        this.shellCommandRunning &&
        isShellTakeoverChord(data)
      ) {
        this.shellTakeoverActive = true;
        this.activeShellBlock?.setTakeoverActive(true);
        this.requestBottomAnchorRefresh();
        return { consume: true };
      }
      return undefined;
    });

    this.tui.start();
    if (this.allowAllOnStartup) {
      this.addChatLine(clr.dim("All permissions bypassed"));
      this.tui.requestRender();
    }
    // Discover reasoning capabilities in background (non-blocking)
    void this.refreshReasoningCapability();
    void this.refreshActiveContextWindow(config, { discover: true });

    if (this.startupResume === "picker") {
      await this.cmdResume("");
    } else if (this.startupResume) {
      await this.applyResumeSession(this.startupResume.sessionId);
    }
  }

  // ?? Mode cycling ?????????????????????????????????????????????????????????

  private applyModeChange(
    next: Mode,
    options?: { prev?: Mode; transition?: "inline" | "chat" }
  ): void {
    const prev = options?.prev ?? this.mode;
    if (prev === next) return;

    this.mode = next;
    setCurrentMode(next);
    this.syncContextBar({ mode: next });
    this.syncModeColor();

    if (SessionManager.getCurrentSession()) {
      void SessionManager.update({ mode: next });
    }

    if (options?.transition) {
      const prevNorm = normalizeMode(prev);
      const nextNorm = normalizeMode(next);
      let modeLine = "";
      if (isDefaultMode(prevNorm) && !isDefaultMode(nextNorm)) {
        modeLine = `${GUTTER}${A.fg(MODE_COLORS[nextNorm] ?? 34, displayModeLabel(nextNorm))}`;
      } else if (!isDefaultMode(prevNorm) && isDefaultMode(nextNorm)) {
        modeLine = `${GUTTER}${A.fg(MODE_COLORS[prevNorm] ?? 34, displayModeLabel(prevNorm))}${MODE_ARROW}`;
      } else if (!isDefaultMode(prevNorm) && !isDefaultMode(nextNorm)) {
        const prevLabel = displayModeLabel(prevNorm);
        const nextLabel = displayModeLabel(nextNorm);
        modeLine = `${GUTTER}${A.fg(MODE_COLORS[prevNorm] ?? 34, prevLabel)}${MODE_ARROW}${A.fg(MODE_COLORS[nextNorm] ?? 34, nextLabel)}`;
      }
      if (modeLine.length > 0) {
        if (options.transition === "inline") {
          if (this.modeChangeText) {
            this.modeChangeText.setText(modeLine);
          } else {
            this.addChatLine("");
            this.modeChangeText = new Text(modeLine, 0, 0);
            this.chat.addChild(this.modeChangeText);
          }
        } else {
          const prevLabel = displayModeLabel(prevNorm);
          const nextLabel = displayModeLabel(nextNorm);
          if (isDefaultMode(prevNorm) && !isDefaultMode(nextNorm)) {
            this.addChatLine(`  ${A.fg(MODE_COLORS[nextNorm] ?? 34, nextLabel)}`);
          } else if (!isDefaultMode(prevNorm) && isDefaultMode(nextNorm)) {
            this.addChatLine(`  ${A.fg(MODE_COLORS[prevNorm] ?? 34, prevLabel)}${MODE_ARROW}`);
          } else if (!isDefaultMode(prevNorm) && !isDefaultMode(nextNorm)) {
            this.addChatLine(
              `  ${A.fg(MODE_COLORS[prevNorm] ?? 34, prevLabel)}${MODE_ARROW}${A.fg(MODE_COLORS[nextNorm] ?? 34, nextLabel)}`
            );
          }
        }
      }
    }
  }

  private cycleMode(dir: 1 | -1): void {
    if (this.isRunning) return;
    const prev = this.mode;
    const idx = MODE_CYCLE.indexOf(this.mode);
    const next = MODE_CYCLE[((idx + dir) + MODE_CYCLE.length) % MODE_CYCLE.length]!;
    this.applyModeChange(next, { prev, transition: "inline" });
    invalidatePromptCache();
    this.tui.requestRender();
  }

  private syncModeColor(): void {
    // Mode color is shown on the context bar; prompt chevron stays dim (see PromptInput).
    this.promptInput.setModeColor(MODE_COLORS[this.mode] ?? 34);
  }

  /** Refresh reasoning capabilities for the current model */
  private activeModelId(config: Config): string {
    const session = SessionManager.getCurrentSession();
    return (
      session?.model?.trim() ||
      config.defaultModel?.trim() ||
      ""
    );
  }

  private providerKeyForModel(modelId: string, config: Config): string {
    if (modelId.includes("/")) return modelId.split("/")[0] ?? config.defaultProvider;
    return config.defaultProvider;
  }

  private findCachedContextWindow(providerKey: string, modelId: string): number | undefined {
    const cached = getCachedModelInfos(providerKey);
    if (!cached) return undefined;

    const bare = modelId.startsWith(`${providerKey}/`)
      ? modelId.slice(providerKey.length + 1)
      : modelId;
    const info = cached.find((entry) =>
      entry.id === modelId ||
      entry.id === bare ||
      `${providerKey}/${entry.id}` === modelId
    );
    return info?.contextTokens;
  }

  private providerOptionForKey(providerKey: string, config: Config): ModelProviderOption {
    return (
      MODEL_PROVIDERS.find((provider) => provider.key === providerKey) ??
      resolveCustomProviderOption(providerKey, config)
    );
  }

  private async resolveContextWindowForModel(
    modelId: string,
    config: Config,
    opts?: { discover?: boolean }
  ): Promise<number | undefined> {
    const providerKey = this.providerKeyForModel(modelId, config);
    const cached = this.findCachedContextWindow(providerKey, modelId);
    if (cached && cached > 0) return cached;

    if (opts?.discover) {
      const stored = providerConfig(config, providerKey);
      if (isStoredProviderConfigured(providerKey, stored)) {
        const provider = this.providerOptionForKey(providerKey, config);
        try {
          await discoverModels(provider, stored.apiKey ?? "", stored.baseUrl);
          const discovered = this.findCachedContextWindow(providerKey, modelId);
          if (discovered && discovered > 0) return discovered;
        } catch {
          // Fall through to models.dev; discovery is best-effort for runtime metadata.
        }
      }
    }

    try {
      const catalog = await loadModelsDevCatalog();
      const info = enrichModelId(providerKey, modelId, catalog);
      return info.contextTokens && info.contextTokens > 0 ? info.contextTokens : undefined;
    } catch {
      return undefined;
    }
  }

  private async refreshActiveContextWindow(
    config?: Config,
    opts?: { discover?: boolean; announce?: boolean }
  ): Promise<void> {
    const cfg = config ?? await loadConfig();
    const activeModel = this.activeModelId(cfg);
    if (!activeModel) return;

    const resolved = await this.resolveContextWindowForModel(activeModel, cfg, opts);
    let window = resolved && resolved > 0 ? resolved : defaultContextWindowForModel(activeModel);
    const usedFallback = !resolved || resolved <= 0;

    const session = SessionManager.getCurrentSession();
    const sessionNeedsUpdate = session?.context_window !== window;
    if (this.contextWindow === window && !sessionNeedsUpdate && !usedFallback) return;

    if (usedFallback) {
      void this.emitStatusEvent(
        `Context window unknown for ${activeModel}; using ${formatContextK(window)} estimate`
      );
    }

    this.contextWindow = window;
    SessionManager.setOptions({ initialContextWindow: window });
    if (sessionNeedsUpdate) {
      await SessionManager.update({ context_window: window });
    }

    this.syncContextBar({ contextWindow: window });
    if (opts?.announce) {
      this.addChatLine(modelStatusLine(`Context window: ${formatContextK(window)}`));
    }
    this.tui?.requestRender();
  }

  private async refreshReasoningCapability(): Promise<void> {
    try {
      const config = await loadConfig();
      const activeModel = this.activeModelId(config);
      const providerName = this.providerKeyForModel(activeModel, config);
      // For Ollama, query /api/show to check if this specific model supports thinking
      if (providerName === "ollama") {
        const modelName = activeModel.replace(/^ollama\//, "");
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
          if (pt && pc?.baseUrl && pc?.apiKey && activeModel) {
            const mn = activeModel.includes("/") ? activeModel.split("/").slice(1).join("/") : activeModel;
            try { this.reasoningCapability = await probeReasoningSupport(pt, pc.baseUrl, pc.apiKey, mn); } catch {}
          }
        }
      }
      await this.normalizeReasoningLevel();
      this.syncContextBar({ reasoningLevel: this.reasoningDisplayLabel() });
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
  }

  private async cycleReasoning(): Promise<void> {
    if (this.isRunning) return;
    const next = cycleReasoningLevel(this.reasoningLevel, this.reasoningCapability);
    await this.setReasoningLevel(next);
  }

  private async setReasoningLevel(level: ReasoningLevel): Promise<void> {
    this.reasoningLevel = level;
    const config = await loadConfig();
    config.reasoningLevel = level;
    config.thinking = level !== "off";
    await saveConfig(config);
    this.syncContextBar({ reasoningLevel: this.reasoningDisplayLabel(level) });
    this.tui.requestRender();
  }

  private estimateCurrentSessionTokens(): number {
    const session = SessionManager.getCurrentSession();
    if (!session?.messages?.length) return 0;
    return estimateSessionContextTokens(session.messages);
  }

  private resetLiveMetrics(): void {
    this.liveTurnStartedAt = Date.now();
    this.liveGeneratedChars = 0;
    this.lastLiveMetricsAt = 0;
  }

  private updateLiveMetrics(_extraContextChars = 0, force = false): void {
    const now = Date.now();
    if (!force && now - this.lastLiveMetricsAt < 250) return;

    this.lastLiveMetricsAt = now;
    // Live context = committed baseline (never drops below the last
    // authoritative count) plus the in-flight streaming/thinking buffer.
    // Persisted tool results are already reflected by the session estimate,
    // so we must NOT fold tool output (extraContextChars) in again or the
    // counter balloons and then snaps back down at turn end.
    const transientChars = this.streamingRaw.length + this.thinkingRaw.length;
    const baseTokens = Math.max(this.contextTokens, this.estimateCurrentSessionTokens());
    const displayTokens = baseTokens + Math.ceil(transientChars / 4);
    const generatedTokens = Math.ceil(this.liveGeneratedChars / 4);
    const elapsedMs = Math.max(1, now - this.liveTurnStartedAt);
    const tokensPerSecond = generatedTokens > 0 ? Math.round((generatedTokens / elapsedMs) * 1000) : undefined;

    this.syncContextBar({
      contextTokens: displayTokens,
      contextWindow: this.contextWindow,
      isRunning: this.isRunning,
      ...(this.speedoEnabled && tokensPerSecond !== undefined
        ? { tokensPerSecond }
        : { tokensPerSecond: undefined }),
    });
  }

  private noteLiveGeneration(text: string): void {
    this.liveGeneratedChars += text.length;
    this.updateLiveMetrics();
  }

  private toolBusyStatus(name: string): string {
    switch (name) {
      case "question":
        return "Waiting for answer ...";
      case "todo_write":
        return "Updating todos ...";
      case "todo_read":
        return "Reading todos ...";
      case "task":
        return "Running subagent ...";
      default:
        return `Running ${name} ...`;
    }
  }

  // ?? Input submission ??????????????????????????????????????????????????????

  private async onSubmit(initialPayload: PromptSubmitPayload): Promise<void> {
    let payload = initialPayload;
    const pathErrors = await this.promptInput.attachImagePathsFromEditor();
    if (pathErrors.length > 0) {
      for (const err of pathErrors) {
        this.addChatLine(clr.warn(err));
      }
      this.tui.requestRender();
      return;
    }

    payload = resolveSubmitPayloadAfterPathAttach(
      initialPayload,
      this.promptInput.getText(),
      () => this.promptInput.getSubmitPayload()
    );
    const input = payload.displayMessage.trim();
    if (!input) {
      if (this.turnQueue.isHoldDrain) {
        this.cancelQueueEdit();
        this.tui.requestRender();
        return;
      }
      if (this.toggleLatestExpandable()) return;
      return;
    }

    if (this.turnQueue.isHoldDrain) {
      this.commitQueueEdit(payload);
      this.tui.requestRender();
      return;
    }

    if (isLoneBang(input)) {
      this.addChatLine(clr.dim("Usage: ! <command>"));
      this.tui.requestRender();
      return;
    }

    const bangCommand = parseBangCommand(input);
    if (bangCommand) {
      this.promptInput.clear();
      void this.runBangCommand(bangCommand);
      return;
    }

    const atQuestion = parseAtReview(input);
    if (atQuestion) {
      if (!this.lastShellOutput) {
        this.addChatLine(clr.warn("No shell output to review yet"));
        this.tui.requestRender();
        return;
      }
      this.promptInput.clear();
      if (this.isRunning) {
        this.enqueueTurn(payload);
        return;
      }
      await this.runShellReview(atQuestion, this.lastShellOutput);
      return;
    }

    if (shouldTreatAsSlashCommand(input)) {
      await this.handleSlash(payload.apiText.trim());
      this.tui.requestRender();
      return;
    }

    const cfg = await loadConfig();
    if (!isModelConfigured(cfg)) {
      // Save the prompt to history even when model isn't configured
      // so the user can retrieve it with the up arrow after configuring the model
      const transcript = userTranscriptText(payload);
      this.promptHistory.push(transcript);
      
      this.addChatLine(
        clr.warn("No model selected. Run ") + clr.tool("/model") + clr.warn(" to choose a provider and model first.")
      );
      this.tui.requestRender();
      return;
    }

    if (this.isRunning) {
      this.promptInput.clear();
      this.enqueueTurn(payload);
      return;
    }

    await this.runTurn(payload);
  }

  // ?? Agent turn ????????????????????????????????????????????????????????????

  private async runTurn(payload: PromptSubmitPayload): Promise<void> {
    if (!this.isNonemptySubmitPayload(payload)) {
      this.drainTurnQueue();
      return;
    }
    const userMessage = payload.apiText;
    const displayMessage = payload.displayMessage;
    const transcript = userTranscriptText(payload);
    // Mid-turn config validation: advisor mode ON but config missing?
    const config = await loadConfig();
    if (config.advisorMode && !isExperimentalAdvisorEnabled(config)) {
      this.addChatLine(
        `${clr.warn("!")} Advisor requires experimental flag. Run ${clr.tool("/experimental")} to enable.`
      );
      this.tui.requestRender();
      return;
    }
    if (config.advisorMode && !config.advisorModel) {
      this.addChatLine(`${clr.warn("!")} Advisor Mode is ON but no advisor model is configured.`);
      if (this.experimentalAdvisorEnabled) {
        this.addChatLine(`${clr.dim("Use /advisor to configure, or /advisor off to disable.")}`);
      } else {
        this.addChatLine(`${clr.dim("Run /experimental to enable advisor features.")}`);
      }
      this.tui.requestRender();
      return;
    }
    if (config.advisorMode && config.advisorModel) {
      const providerKey = config.advisorModel.split("/")[0] ?? config.defaultProvider;
      const stored = providerConfig(config, providerKey);
      if (!isStoredProviderConfigured(providerKey, stored)) {
        const fix = this.experimentalAdvisorEnabled
          ? "Use /advisor to reconfigure."
          : "Run /experimental first.";
        this.addChatLine(`${clr.warn("!")} Advisor provider (${providerKey}) is not configured. ${fix}`);
        this.tui.requestRender();
        return;
      }
    }

    if (SessionManager.getCurrentSession()) {
      void SessionManager.update({ mode: this.mode });
    }

    this.promptInput.clear();
    this.promptHistory.push(transcript);

    this.isRunning = true;
    this.modeChangeText = null;
    this.turnShowsImpulseHeader = false;

    this.addSectionGap();
    this.lastBandWasTool = false;
    this.lastBandToolHadBody = false;
    this.addChatLine(`${A.fg(36, this.userName)}`);
    this.addChatLine(transcript);
    this.addSectionGap();

    this.streamingRaw = "";
    this.streamingText = null;
    this.thinkingRaw = "";
    this.thinkingText = null;
    this.thinkingOpen = false;
    this.thinkingStartedAt = 0;
    this.thinkingElapsedMs = 0;
    this.resetLiveMetrics();
    this.loop.setImages(
      payload.orderedImages.map((i) => ({ uri: i.uri, display: i.display }))
    );
    this.syncContextBar({
      isRunning: true,
      mode: this.mode,
      contextTokens: this.contextTokens,
      contextWindow: this.contextWindow,
    });

    const cfgForVision = await loadConfig();
    if (payload.orderedImages.length > 0) {
      const sessionModel =
        SessionManager.getCurrentSession()?.model?.trim() ||
        cfgForVision.defaultModel?.trim() ||
        "";
      const visionAvailable =
        modelSupportsVisionCached(sessionModel) ||
        (cfgForVision.visionMode === true && Boolean(cfgForVision.visionModel));
      if (!visionAvailable) {
        this.addChatLine(
          clr.dim("Images attached — vision unavailable for this model. Use /model for a vision-capable model.")
        );
      } else if (cfgForVision.visionMode && cfgForVision.visionModel) {
        this.setBusyStatus("Translating images ...", BUSY_PROCESSING);
      }
    }

    const events: LoopEvents = {
      onTurnStart: () => {
        this.clearCtrlCPending();
        this.currentTurnAssistantText = "";
        this.streamBusyPhraseSet = false;
        this.contextTokens = Math.max(
          this.contextTokens,
          this.estimateCurrentSessionTokens()
        );
        this.syncContextBar({
          contextTokens: this.contextTokens,
          contextWindow: this.contextWindow,
          mode: this.mode,
          isRunning: true,
        });
        this.updateLiveMetrics(0, true);
        this.setBusyStatus("Thinking ...", BUSY_PROCESSING);
        this.freezeTurnAnchor();
      },
      onToken: (text) => {
        if (!this.streamBusyPhraseSet) {
          this.setBusyStatus("Responding ...", BUSY_PROCESSING);
          this.streamBusyPhraseSet = true;
        }
        this.closeThinking();
        if (!this.streamingText) {
          if (this.lastBandWasTool) {
            this.addSectionGap();
          }
          this.lastBandWasTool = false;
          if (!this.turnShowsImpulseHeader) {
            this.chat.addChild(new Text(`${GUTTER}${A.fg(33, "impulse")}${A.reset}`, 0, 0));
            this.turnShowsImpulseHeader = true;
          }
          this.hasTrailingGap = false;
          this.streamingText = new MarkdownTextBlock(GUTTER);
          this.chat.addChild(this.streamingText);
          this.hasTrailingGap = false;
        }
        this.streamingRaw += text;
        this.streamingText.setText(this.streamingRaw);
        this.noteLiveGeneration(text);
        this.scheduleStreamRender();
      },
      onThinking: (text) => {
        debugLog(`onThinking: ${text.length} chars`);
        this.appendWorkerThinking(text);
        this.scheduleStreamRender();
      },
      onAdvisorStart: (_model) => {
        this.setBusyStatus("", "Advisor consultation...");
        this.tui.requestRender();
      },
      onAdvisorToken: (_text) => { /* buffered */ },
      onAdvisorEnd: (_summary) => {
        this.spinStop();
        this.tui.requestRender();
      },
      onPlanApproval: (input) => this.showPlanApprovalOverlay(input),
      onTaskBatchPermission: (input) => this.showTaskBatchPermission(input.count),
      onLoopCheckin: (input) => this.showLoopCheckin(input),
      onSubagentTaskStatus: (id, status) => {
        const block = this.toolBlocks.get(id);
        if (block) {
          block.setSubagentTaskStatus(status);
          this.tui.requestRender();
        }
      },
      onToolStart: (id, name, args) => {
        // Silent tools still finalize any open stream so continuation text is a new block.
        if (SILENT_TOOLS.has(name)) {
          this.finalizeAssistantStreamingSegment(true);
          return;
        }

        this.closeThinking();
        this.finalizeAssistantStreamingSegment(false);
        this.preToolSpacing = {
          lastBandWasTool: this.lastBandWasTool,
          lastBandToolHadBody: this.lastBandToolHadBody,
          hasTrailingGap: this.hasTrailingGap,
        };
        this.lastToolGapSpacer = null;
        const gapBeforeTool = !this.lastBandWasTool || this.lastBandToolHadBody;
        if (gapBeforeTool) {
          this.lastToolGapSpacer = this.addSectionGap();
        }
        let subagentCodename: string | undefined;
        if (name === "task") {
          subagentCodename = pickUniqueShipName(new Set(this.taskCodenames.values()));
          this.taskCodenames.set(id, subagentCodename);
        }

        const block = new ToolBlock(
          name,
          args,
          subagentCodename !== undefined ? { subagentCodename } : undefined
        );
        this.toolBlocks.set(id, block);
        this.chat.addChild(block);
        this.hasTrailingGap = false;
        this.lastBandWasTool = true;
        this.lastBandToolHadBody = false;
        this.lastExpandableTool = block;
        if (name === "todo_write" || name === "todo_read") {
          this.markLatestTodoBlock(block);
        }

        const toolPhrase =
          name === "vision_translate" ? BUSY_PROCESSING : BUSY_WORKING;
        this.setBusyStatus(this.toolBusyStatus(name), toolPhrase);
        this.updateLiveMetrics(0, true);
        this.tui.requestRender();
      },
      onToolEnd: (id, _name, result, durationMs) => {
        if (SILENT_TOOLS.has(_name)) {
          return;
        }

        this.thinkingElapsedMs = 0;

        this.taskCodenames.delete(id);

        const block = this.toolBlocks.get(id);
        if (block) {
          if (isSilentUnchangedTodoWrite(_name, result)) {
            if (this.latestTodoBlock === block) {
              this.latestTodoBlock = null;
            }
            if (this.lastExpandableTool === block) {
              this.lastExpandableTool = null;
            }
            this.chat.removeChild(block);
            if (this.lastToolGapSpacer) {
              this.chat.removeChild(this.lastToolGapSpacer);
              this.lastToolGapSpacer = null;
            }
            if (this.preToolSpacing) {
              this.lastBandWasTool = this.preToolSpacing.lastBandWasTool;
              this.lastBandToolHadBody = this.preToolSpacing.lastBandToolHadBody;
              this.hasTrailingGap = this.preToolSpacing.hasTrailingGap;
              this.preToolSpacing = null;
            }
            this.toolBlocks.delete(id);
            if (!this.isRunning) {
              this.tui.requestRender();
              return;
            }
            this.setBusyStatus("Waiting for model ...", BUSY_PROCESSING);
            this.updateLiveMetrics(result.output.length, true);
            this.tui.requestRender();
            return;
          }

          const compact =
            this.compactToolOutputEnabled &&
            shouldCompactToolOutput(_name, result.success, result.metadata);
          const collapsed =
            _name === "task" || compact || (_name === "question" && result.success);
          if (compact) this.lastExpandableTool = block;
          const shouldReveal =
            (_name === "file_write" || _name === "file_edit") &&
            result.success &&
            extractDiffLinesFromMetadata(result.metadata).length > 0;

          if (shouldReveal && block.beginDiffReveal(result, durationMs)) {
            this.ensureDiffRevealLoop();
          } else {
            block.setDone(result, durationMs, { collapsed, compact });
            this.lastBandToolHadBody = block.hasExpandedBody();
            if (_name === "todo_write" || _name === "todo_read") {
              this.markLatestTodoBlock(block);
            }
            this.toolBlocks.delete(id);
          }
        }
        if (!this.isRunning) {
          this.tui.requestRender();
          return;
        }

          this.setBusyStatus("Waiting for model ...", BUSY_PROCESSING);
        this.updateLiveMetrics(result.output.length, true);
        this.tui.requestRender();
      },
      onCompacting: () => {
        this.compactStartMs = Date.now();
        this.addChatLine(clr.dim("Auto-compaction in progress"));
        this.setBusyStatus("Compacting...", BUSY_COMPACTING);
        this.tui.requestRender();
      },
      onCompacted: (removedCount, _summary, contextTokens) => {
        this.contextTokens = contextTokens ?? this.estimateCurrentSessionTokens();
        const elapsed = this.compactStartMs > 0
          ? ((Date.now() - this.compactStartMs) / 1000).toFixed(1)
          : null;
        this.addSectionGap();
        this.addChatLine(
          clr.dim(
            elapsed
              ? `Compacted — removed ${removedCount} messages, ${elapsed}s`
              : `Compacted — removed ${removedCount} messages`
          )
        );
        this.compactStartMs = 0;
        this.setBusyStatus("Thinking ...", BUSY_PROCESSING);
        this.syncContextBar({
          contextTokens: this.contextTokens,
          contextWindow: this.contextWindow,
        });
        this.tui.requestRender();
      },
      onTurnEnd: (usage) => {
        this.spinStop();
        this.dismissQuestionOverlay(false);
        this.closeThinking();
        this.appendAssistantTurnSegment(this.streamingRaw);
        const turnText = this.currentTurnAssistantText;
        this.currentTurnAssistantText = "";
        if (this.streamingRaw) { this.addSectionGap(); }
        this.streamingRaw = ""; this.streamingText = null;
        this.thinkingRaw = "";  this.thinkingText = null;
        this.thinkingElapsedMs = 0;

        this.contextTokens = usage.inputTokens;
        this.syncContextBar({
          contextTokens: usage.inputTokens,
          contextWindow: this.contextWindow,
          mode: this.mode,
          isRunning: false,
          ...(this.speedoEnabled
            ? {
                ...(usage.tokensPerSecond > 0 ? { tokensPerSecond: usage.tokensPerSecond } : {}),
                lastTurnMs: usage.durationMs,
              }
            : { tokensPerSecond: undefined, lastTurnMs: undefined }),
        });

        if (usage.cacheReadTokens !== undefined && usage.cacheReadTokens > 0) {
          void this.persistCacheReadTokens(usage.cacheReadTokens);
        }

        if (usage.debugInstrumentationNudge) {
          this.addChatLine(clr.warn(usage.debugInstrumentationNudge));
        }

        this.lastAssistantTurnText = turnText;
        this.addSectionGap();
        this.lastBandWasTool = false;
        this.turnShowsImpulseHeader = false;
        this.isRunning = false;
        this.tui.setFocus(this.promptInput);
        this.tui.requestRender();
        if (this.goalLoopActive()) {
          void this.maybeContinueGoalLoop();
        } else {
          this.drainTurnQueue();
        }
      },
      onError: (err) => {
        this.spinStop();
        this.dismissQuestionOverlay(false);
        this.syncContextBar({ isRunning: false });
        this.addChatLine(`${clr.error("Error:")} ${err.message}`);
        this.isRunning = false;
        this.tui.setFocus(this.promptInput);
        this.tui.requestRender();
        this.drainTurnQueue();
      },
      onHardCutoff: (tokens) => {
        this.spinStop();
        this.dismissQuestionOverlay(false);
        this.contextTokens = tokens;
        this.syncContextBar({
          isRunning: false,
          contextTokens: tokens,
          contextWindow: this.contextWindow,
        });
        const pct = Math.round((tokens / this.contextWindow) * 100);
        void this.emitStatusEvent(
          `Context limit reached: ${tokens} / ${this.contextWindow} tokens (${pct}%). Use /compact or /new to continue.`
        );
        this.isRunning = false;
        this.tui.setFocus(this.promptInput);
        this.tui.requestRender();
        this.drainTurnQueue();
      },
    };
    await this.refreshActiveContextWindow(config, { discover: true });

    await this.loop.run(userMessage, this.mode, events, {
      displayMessage,
      segments: payload.segments,
    });

    // Auto-off suggestion: all todos complete + advisor mode ON
    await this.checkAutoOffSuggestion();
  }

  // ?? Helpers ???????????????????????????????????????????????????????????????

  private scheduleStreamRender(): void {
    if (this.streamRenderScheduled) return;
    this.streamRenderScheduled = true;
    setTimeout(() => {
      this.streamRenderScheduled = false;
      this.tui?.requestRender();
    }, 16);
  }

  private toggleLatestExpandable(): boolean {
    if (this.lastExpandableTool?.toggleExpanded()) {
      this.tui.requestRender();
      return true;
    }
    if (this.lastExpandableThinking?.toggleExpanded()) {
      this.tui.requestRender();
      return true;
    }
    return false;
  }

  private syncGoalContextBar(): void {
    const label =
      this.goalState?.status === "active"
        ? this.goalState.text
        : undefined;
    this.syncContextBar({ goalLabel: label });
  }

  private async emitStatusEvent(text: string, opts?: { live?: boolean }): Promise<void> {
    const live = opts?.live !== false;
    if (SessionManager.getCurrentSessionID()) {
      await SessionManager.addMessage({
        role: "system",
        content: formatImpulseUiStatus(text),
        timestamp: new Date().toISOString(),
      });
    }
    if (live) {
      this.addChatLine(clr.dim(text));
    }
  }

  private addChatLine(text: string): void {
    const lines = wrapGutterLines(text, this.terminal.columns);
    for (const line of lines) {
      this.chat.addChild(new Text(line, 0, 0));
    }
    this.hasTrailingGap = false;
    this.lastBandWasTool = false;
    this.lastBandToolHadBody = false;
  }

  private addSectionGap(): Spacer | null {
    if (this.hasTrailingGap) return null;
    const spacer = new Spacer(1);
    this.chat.addChild(spacer);
    this.hasTrailingGap = true;
    return spacer;
  }

  /** Block agent loop until user approves or declines advisor plan */
  private async showPlanApprovalOverlay(input: {
    planPath: string;
    summary: string;
    planMarkdown: string;
  }): Promise<"proceed" | "decline"> {
    if (!this.tui) return "decline";

    const shortPath = input.planPath.replace(
      new RegExp(`^${os.homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      "~"
    );

    const overlay = new PlanApprovalOverlay({
      planPath: shortPath,
      summary: input.summary,
      planMarkdown: input.planMarkdown,
    });

    return new Promise<"proceed" | "decline">((resolve) => {
      this.dismissPlanApprovalOverlay();

      const handle = this.tui.showOverlay(overlay, {
        anchor: "bottom-center",
        offsetY: -4,
        width: "100%",
        minWidth: this.overlayMin(),
        maxHeight: LIST_OVERLAY_MAX_HEIGHT,
        margin: this.listOverlayMargin(),
      });
      this.planApprovalOverlayHandle = handle;
      this.setBusyStatus("Waiting for plan approval ...", "Reviewing plan...");
      handle.focus();

      overlay.onDecision = (decision) => {
        this.dismissPlanApprovalOverlay();
        if (decision === "proceed") {
          this.addChatLine(advisorStatusLine("Plan approved — continuing"));
        } else {
          this.addChatLine(advisorStatusLine("Plan declined — awaiting new instructions"));
        }
        this.tui.setFocus(this.promptInput);
        this.tui.requestRender();
        resolve(decision);
      };

      this.planApprovalInputCleanup = this.tui.addInputListener((data: string) => {
        overlay.handleInput(data);
        this.tui.requestRender();
        return { consume: true };
      });
    });
  }

  private dismissPlanApprovalOverlay(): void {
    this.planApprovalInputCleanup?.();
    this.planApprovalInputCleanup = null;
    this.planApprovalOverlayHandle?.hide();
    this.planApprovalOverlayHandle = null;
  }

  /**
   * Calculate total content height for bottom-anchor positioning.
   * Returns the number of lines occupied by all TUI children except the BottomAnchorSpacer.
   */
  private measureComponentLines(component: Component | undefined, width: number): number {
    if (!component || !("render" in component) || typeof component.render !== "function") {
      return 0;
    }
    return component.render(width).length;
  }

  private getContentHeight(): number {
    let chatLines = 0;
    const width = Math.max(20, this.tui?.terminal?.columns ?? 80);
    for (const child of this.chat.children) {
      chatLines += this.measureComponentLines(child as Component, width);
    }

    // Spacer above spinner (1) + separator + prompt + separator + context bar (3)
    let otherLines = 1 + 1 + 1 + 1 + 3;
    otherLines += this.measureComponentLines(this.spinnerText, width);
    otherLines += this.measureComponentLines(this.modelSetupText, width);
    otherLines += this.measureComponentLines(this.autocompleteText, width);
    otherLines += this.measureComponentLines(this.promptInput as unknown as Component, width);

    return chatLines + otherLines;
  }

  private requestBottomAnchorRefresh(): void {
    this.bottomSpacer?.invalidate();
    this.tui?.requestRender();
  }

  private freezeTurnAnchor(): void {
    const rows = this.tui?.terminal?.rows ?? 24;
    this.turnAnchorEmptyLines = Math.max(0, rows - this.getContentHeight());
    this.requestBottomAnchorRefresh();
  }

  private releaseTurnAnchor(): void {
    if (this.turnAnchorEmptyLines === null) return;
    this.turnAnchorEmptyLines = null;
    this.requestBottomAnchorRefresh();
  }

  // ?? Slash autocomplete ????????????????????????????????????????????????????

  private slashCommands(): SlashCommandEntry[] {
    return buildSlashCommandList({
      experimentalAdvisor: this.experimentalAdvisorEnabled,
      experimentalUndo: this.experimentalUndoEnabled,
      experimentalGoal: this.experimentalGoalEnabled,
    });
  }

  private resetSlashTabCycleIfNeeded(input: string): void {
    if (!this.slashTabCycle) return;
    const token = input.trimStart().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (!token.startsWith(this.slashTabCycle.prefix)) {
      this.slashTabCycle = null;
    }
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
        const raw = `${GUTTER}${A.fg(36, m.cmd)}  ${A.fg(90, m.hint ?? "")}`;
        return wrapTextWithAnsi(raw, avail);
      });
      this.autocompleteText.setText(lines.join("\n"));
    }
    this.requestBottomAnchorRefresh();
  }

  // ?? Exit ??????????????????????????????????????????????????????????????????

  private async gracefulExit(): Promise<void> {
    await SessionManager.flushCurrent();
    const session = SessionManager.getCurrentSession();
    const config = await loadConfig();
    this.branchWatcher?.dispose();
    this.tui.stop();
    if (session?.id) {
      const title =
        session.headerTitle?.trim() || session.name?.trim() || "Untitled session";
      printSessionExitMessage(
        {
          id: session.id,
          title,
          model: session.model,
        },
        {
          includeStats: config.statsOnExit === true,
          fullSession: session,
        }
      );
    }
    process.exit(0);
  }

  /**
   * Freeze the current assistant streaming segment so the next onToken starts a new block.
   * Without this, silent tools (set_header) leave streamingRaw open and glue the next
   * continuation chunk onto the same paragraph.
   */
  private appendAssistantTurnSegment(segment: string): void {
    const trimmed = segment.trim();
    if (!trimmed) return;
    this.currentTurnAssistantText = this.currentTurnAssistantText
      ? `${this.currentTurnAssistantText}\n\n${trimmed}`
      : trimmed;
  }

  private finalizeAssistantStreamingSegment(gapAfter = true): void {
    if (!this.streamingRaw && !this.streamingText) return;
    const hadContent = this.streamingRaw.trim().length > 0;
    if (hadContent) {
      this.appendAssistantTurnSegment(this.streamingRaw);
    }
    this.streamingRaw = "";
    this.streamingText = null;
    if (gapAfter && hadContent) {
      this.addSectionGap();
    }
  }

  private closeThinking(): void {
    if (this.thinkingOpen && this.thinkingText) {
      if (this.thinkingStartedAt > 0) {
        this.thinkingElapsedMs += Date.now() - this.thinkingStartedAt;
        this.thinkingStartedAt = 0;
      }
      const durationMs = this.thinkingElapsedMs;
      if (this.thinkingRaw.trim()) {
        this.thinkingText.setText(this.thinkingRaw);
      }
      this.thinkingText.finalize(durationMs);
      this.lastExpandableThinking = this.thinkingText;
      if (this.thinkingDisplay === "full") {
        this.thinkingText.setExpanded(true);
      }
      debugLog(`Thinking block closed (${durationMs}ms)`);
      this.addSectionGap();
      this.thinkingOpen = false;
    }
  }

  // ?? Slash commands ????????????????????????????????????????????????????????

  private slashHost(): SlashDispatchHost {
    const r = this;
    return {
      get isRunning() {
        return r.isRunning;
      },
      cmdAdvisor: (arg) => r.cmdAdvisor(arg),
      cmdExperimental: () => r.cmdExperimental(),
      cmdSettings: () => r.cmdSettings(),
      showConfigAliasHint: () => r.showConfigAliasHint(),
      cmdUpdate: () => r.cmdUpdate(),
      cmdModel: (arg) => r.cmdModel(arg),
      showVisionHint: () => r.showVisionHint(),
      cmdMode: (arg) => r.cmdMode(arg),
      showReasoningHint: () => r.showReasoningHint(),
      cmdUsage: () => r.cmdUsage(),
      cmdCheckpoint: () => r.cmdCheckpoint(),
      cmdUndo: (arg) => r.cmdUndo(arg),
      cmdRedo: (arg) => r.cmdRedo(arg),
      cmdGoal: (arg) => r.cmdGoal(arg),
      cmdAllowAll: (arg) => r.cmdAllowAll(arg),
      showExpressRemovedHint: () => r.showExpressRemovedHint(),
      cmdUser: (arg) => r.cmdUser(arg),
      cmdResume: (arg) => r.cmdResume(arg),
      toggleDebug: () => r.toggleDebug(),
      showSpeedoHint: () => r.showSpeedoHint(),
      cmdNew: (arg) => r.cmdNew(arg),
      cmdClearScreen: () => r.cmdClearScreen(),
      cmdShow: () => r.cmdShow(),
      showHelpOverlay: () => r.showHelpOverlay(),
      cmdSteer: (arg) => r.cmdSteer(arg),
      cmdCopy: () => r.cmdCopy(),
      cmdSide: (arg) => r.cmdSide(arg),
      showThinkingSettingsHint: () => r.showThinkingSettingsHint(),
      cmdCompact: () => r.cmdCompact(),
      gracefulExit: () => r.gracefulExit(),
      showUnknownSlash: (cmd) => r.showUnknownSlash(cmd),
    };
  }

  private async handleSlash(input: string): Promise<void> {
    await dispatchSlashCommand(input, this.slashHost());
  }

  private showConfigAliasHint(): void {
    this.addChatLine(clr.dim("Use /settings"));
    this.tui.requestRender();
  }

  private showVisionHint(): void {
    this.addChatLine(clr.dim("Vision is automatic — configure override in /settings"));
    this.tui.requestRender();
  }

  private showReasoningHint(): void {
    this.addChatLine(clr.dim("Reasoning level: /settings"));
    this.tui.requestRender();
  }

  private showExpressRemovedHint(): void {
    this.addChatLine(clr.dim("Removed — use /allow-all to bypass permission prompts."));
    this.tui.requestRender();
  }

  private showSpeedoHint(): void {
    this.addChatLine(clr.dim("Turn speed moved to /settings"));
    this.tui.requestRender();
  }

  private showThinkingSettingsHint(): void {
    this.addChatLine(clr.dim("Use /settings → Thinking display"));
    this.tui.requestRender();
  }

  private async toggleDebug(): Promise<void> {
    const enabling = !isDebugEnabled();
    setDebugEnabled(enabling);

    if (enabling) {
      const { enableDebugLog } = await import("../util/debug-log.js");
      const jsonlPath = await enableDebugLog();
      this.addChatLine(clr.dim(`Debug logging enabled`));
      this.addChatLine(clr.dim(`JSONL: ${jsonlPath}`));
      debugLog("Debug logging enabled");
    } else {
      const { disableDebugLog } = await import("../util/debug-log.js");
      disableDebugLog();
      this.addChatLine(clr.dim("Debug logging disabled"));
    }
  }

  private async cmdNew(arg: string): Promise<void> {
    if (arg) {
      this.addChatLine(clr.dim("Optional session name is not documented; starting a new session."));
    }
    await SessionManager.createNew(arg || undefined);
    const newCfg = await loadConfig();
    if (newCfg.defaultModel?.trim()) {
      await SessionManager.update({ model: newCfg.defaultModel });
    }
    resetAllowAllBypass();
    this.syncAllowAllBypassUi();
    this.speedoEnabled = false;
    this.syncSpeedoUi();
    this.promptHistory.reset();
    this.resetTurnUiState();
    this.clearChatView();
    this.addChatLine(clr.dim("New session started"));
    this.applySessionToRenderer(SessionManager.getCurrentSession()!);
  }

  private cmdClearScreen(): void {
    this.resetTurnUiState();
    this.clearChatView();
    this.addChatLine(clr.dim("Screen cleared — session history preserved"));
    this.tui.requestRender();
  }

  private cmdSteer(arg: string): void {
    if (!arg) {
      this.addChatLine(clr.dim("Usage: /steer <instruction>"));
    } else if (!this.isRunning) {
      this.addChatLine(clr.dim("No active turn — /steer applies during an agent turn"));
    } else {
      this.loop.setSteer(arg);
      this.addChatLine(clr.dim(`steer: ${arg}`));
      this.addChatLine(clr.dim("applies before the model's next action"));
    }
    this.tui.requestRender();
  }

  private async cmdCopy(): Promise<void> {
    const text = this.lastAssistantTurnText.trim();
    if (!text) {
      this.addChatLine(clr.warn("Nothing to copy — no assistant response yet"));
    } else {
      await copyToClipboard(text);
      this.addChatLine(clr.dim(`Copied last response (${text.length} chars)`));
    }
    this.tui.requestRender();
  }

  private async cmdCompact(): Promise<void> {
    const sessionID = SessionManager.getCurrentSessionID();
    if (!sessionID) {
      this.addChatLine(clr.warn("No active session"));
      return;
    }
    this.compactStartMs = Date.now();
    this.addChatLine(clr.dim("Compaction in progress"));
    this.setBusyStatus("Compacting...", BUSY_COMPACTING);
    const result = await CompactManager.compact(sessionID, true, { force: true });
    this.spinStop();
    this.contextTokens = this.estimateCurrentSessionTokens();
    if (result.compacted) {
      const elapsed =
        this.compactStartMs > 0 ? ((Date.now() - this.compactStartMs) / 1000).toFixed(1) : null;
      this.addSectionGap();
      this.addChatLine(
        clr.dim(
          elapsed
            ? `Compacted — removed ${result.removedCount} messages, ${elapsed}s`
            : `Compacted — removed ${result.removedCount} messages`
        )
      );
    } else {
      this.addSectionGap();
      this.addChatLine(clr.dim("Session already within size limits"));
    }
    this.compactStartMs = 0;
    this.syncContextBar();
    this.tui.requestRender();
  }

  private showUnknownSlash(cmd: string): void {
    this.addChatLine(clr.warn(`Unknown: /${cmd}  --  try /help`));
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
      lines.push(clr.bold(this.setupTitle(state)));
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
      if (state.pendingRemoveProvider) {
        lines.push(
          clr.warn(
            `Remove ${state.pendingRemoveProvider.label}? Enter: confirm  Esc: cancel`
          )
        );
      } else {
        lines.push(
          clr.dim(
            "↑/↓: Navigate  Enter: Select/add  e: Edit  d: Remove  Esc: Cancel"
          )
        );
      }
    } else if (state.step === "providerName") {
      lines.push(clr.bold(this.setupTitle(state)));
      lines.push(this.setupSectionRule());
      lines.push("");
      lines.push("Custom provider name (slug)");
      lines.push("");
      lines.push(clr.dim("Letters, numbers, hyphens, underscores — e.g. my-llm"));
    } else if (state.step === "baseUrl") {
      lines.push(clr.bold(this.setupTitle(state)));
      lines.push(this.setupSectionRule());
      lines.push("");
      lines.push(`${state.provider?.label ?? "Provider"} endpoint`);
      lines.push("");
      lines.push(clr.dim("Enter a custom endpoint or press Enter to keep the default."));
    } else if (state.step === "apiKey") {
      lines.push(clr.bold(this.setupTitle(state)));
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
      lines.push(clr.bold(this.setupTitle(state)));
      lines.push(this.setupSectionRule());
      lines.push("");
      lines.push(`Discovering ${state.provider?.label ?? "provider"} models...`);
      lines.push("");
      lines.push(clr.dim("Testing connection..."));
    } else if (state.step === "model") {
      lines.push(clr.bold(this.setupTitle(state)));
      lines.push(this.setupSectionRule());
      lines.push("");
      if (state.discovery) {
        const marker = state.discovery.success ? clr.success("[OK]") : clr.warn("[WARN]");
        lines.push(`${marker} ${state.discovery.message}`);
      }
      lines.push("");
      lines.push(clr.dim("  Use the overlay: ?/? navigate, Enter to select, Esc to go back."));
    } else if (state.step === "modelManual") {
      lines.push(clr.bold(this.setupTitle(state)));
      lines.push(this.setupSectionRule());
      lines.push("");
      lines.push(clr.dim("  Enter the full model ID for this provider."));
    } else if (state.step === "reasoning") {
      lines.push(clr.bold(this.setupTitle(state)));
      lines.push(this.setupSectionRule());
      lines.push("");
      lines.push(modelStatusLine(`Selected: ${state.selectedModel ?? ""}`));
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
    this.requestBottomAnchorRefresh();
  }

  private async selectModelSetupProvider(
    provider: ModelProviderOption,
    opts?: { edit?: boolean }
  ): Promise<void> {
    const state = this.modelSetup;
    if (!state) return;

    const effectiveKey = provider.isCustom
      ? (state.customProviderName ?? provider.key)
      : provider.key;
    const existing = providerConfig(state.config, effectiveKey);
    state.provider = provider;
    state.existing = existing;
    const baseUrl = existing.baseUrl ?? provider.defaultBaseUrl;
    if (baseUrl) state.baseUrl = baseUrl;
    else delete state.baseUrl;
    delete state.error;
    delete state.pendingRemoveProvider;

    if (opts?.edit && isStoredProviderConfigured(effectiveKey, existing)) {
      await this.clearModelsUsingProvider(state.config, effectiveKey);
      state.editingProvider = true;
      state.step = provider.needsBaseUrl ? "baseUrl" : "apiKey";
      this.renderModelSetup();
      return;
    }

    if (provider.isCustom && !isStoredProviderConfigured(effectiveKey, existing)) {
      state.step = "providerName";
      this.renderModelSetup();
      return;
    }

    // If provider already configured, skip to model discovery (unless editing)
    if (isStoredProviderConfigured(effectiveKey, existing) && !opts?.edit) {
      state.apiKey = existing.apiKey ?? "";
      state.step = "discovering";
      this.renderModelSetup();
      const discovery = await discoverModels(provider, existing.apiKey ?? "", state.baseUrl);
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
        entry.valid = isStoredProviderConfigured(entry.provider.key, stored);
      } catch {
        entry.valid = false;
      }
    }
    this.renderModelSetup();
  }

  private cancelModelSetup(): void {
    this.dismissModelSetupOverlay();
    if (this.modelSetupInputListener) {
      this.modelSetupInputListener();
      this.modelSetupInputListener = null;
    }
    this.restorePromptAutocomplete();
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

    this.promptInput.clear();

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

    if (state.step === "providerName") {
      const provider = state.provider;
      if (!provider) return;
      const slug = input || state.customProviderName || "";
      const validationError = validateProviderName(slug);
      if (validationError) {
        state.error = validationError;
        this.renderModelSetup();
        return;
      }
      const existingSlug = providerConfig(state.config, slug);
      if (isStoredProviderConfigured(slug, existingSlug)) {
        state.error = `Provider "${slug}" already exists. Choose a different name.`;
        this.renderModelSetup();
        return;
      }
      state.customProviderName = slug;
      state.step = provider.needsBaseUrl ? "baseUrl" : "apiKey";
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
      const apiKey = input || state.existing?.apiKey || "";
      if (provider.key !== "ollama" && !apiKey) {
        state.error = `${provider.label} requires an API key.`;
        this.renderModelSetup();
        return;
      }
      if (provider.key === "ollama" && !apiKey && !state.baseUrl) {
        state.error = "Ollama requires an API key or endpoint URL.";
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
    const apiKey = state?.apiKey ?? "";
    if (!state || !provider) return;
    const effectiveKeyForCheck = provider.isCustom
      ? (state.customProviderName ?? provider.key)
      : provider.key;
    if (
      !isStoredProviderConfigured(effectiveKeyForCheck, {
        apiKey,
        ...(state.baseUrl ? { baseUrl: state.baseUrl } : {}),
      })
    ) {
      return;
    }
    const effectiveKey = provider.isCustom ? (state.customProviderName ?? provider.key) : provider.key;

    this.dismissModelSetupOverlay();

    const purpose = this.setupPurpose(state);

    if (purpose === "vision") {
      const providers = { ...(state.config.providers as Record<string, StoredProviderConfig | undefined>) };
      providers[effectiveKey] = {
        ...(state.existing ?? {}),
        ...(apiKey ? { apiKey } : {}),
        ...(state.baseUrl ? { baseUrl: state.baseUrl } : {}),
        ...(provider.customType ? { type: provider.customType } : {}),
      };
      state.config.providers = providers as Config["providers"];
      state.config.visionModel = selectedModel;
      state.config.visionMode = true;
      await saveConfig(state.config);
      await saveHomeEnv(provider, apiKey, state.baseUrl);
      await this.persistSessionVision(true, selectedModel);
      resetProviderManager();
      this.syncVisionFromConfig(await loadConfig());
      if (this.modelSetupInputListener) {
        this.modelSetupInputListener();
        this.modelSetupInputListener = null;
      }
      this.restorePromptAutocomplete();
      this.modelSetup = null;
      this.modelSetupText.setText("");
      this.promptInput.setSecretMode(false);
      this.promptInput.clear();
      this.addChatLine(
        clr.dim(`Vision ON  --  ${selectedModel.split("/").pop() ?? selectedModel}`)
      );
      this.requestBottomAnchorRefresh();
      return;
    }

    if (purpose === "subagent") {
      const providers = { ...(state.config.providers as Record<string, StoredProviderConfig | undefined>) };
      providers[effectiveKey] = {
        ...(state.existing ?? {}),
        ...(apiKey ? { apiKey } : {}),
        ...(state.baseUrl ? { baseUrl: state.baseUrl } : {}),
        ...(provider.customType ? { type: provider.customType } : {}),
      };
      state.config.providers = providers as Config["providers"];
      state.config.subagentModel = selectedModel;
      state.config.useSubagentModel = true;
      await saveConfig(state.config);
      await saveHomeEnv(provider, apiKey, state.baseUrl);
      resetProviderManager();
      if (this.modelSetupInputListener) {
        this.modelSetupInputListener();
        this.modelSetupInputListener = null;
      }
      this.restorePromptAutocomplete();
      this.modelSetup = null;
      this.modelSetupText.setText("");
      this.promptInput.setSecretMode(false);
      this.promptInput.clear();
      this.addChatLine(modelStatusLine(`Subagent model: ${selectedModel}`));
      this.requestBottomAnchorRefresh();
      return;
    }

    // Advisor mode: only save advisorModel, don't change default provider/model
    if (purpose === "advisor" || state.isAdvisorMode) {
      // Save API key to providers config
      const providers = { ...(state.config.providers as Record<string, StoredProviderConfig | undefined>) };
      providers[effectiveKey] = {
        ...(state.existing ?? {}),
        ...(apiKey ? { apiKey } : {}),
        ...(state.baseUrl ? { baseUrl: state.baseUrl } : {}),
      ...(provider.customType ? { type: provider.customType } : {}),
      };
      state.config.providers = providers as Config["providers"];
      state.config.advisorModel = selectedModel;
      state.config.advisorMode = true;
      await saveConfig(state.config);
      await this.persistSessionAdvisor(true, selectedModel);
      await saveHomeEnv(provider, apiKey, state.baseUrl);
      resetProviderManager();
      this.syncAdvisorFromConfig(await loadConfig());
      this.advisorModel = selectedModel;
      if (reasoningLevel) void this.setReasoningLevel(reasoningLevel);
      this.syncContextBar({ advisorModel: selectedModel, reasoningLevel: this.reasoningDisplayLabel(reasoningLevel) });
      if (this.modelSetupInputListener) {
        this.modelSetupInputListener();
        this.modelSetupInputListener = null;
      }
      this.restorePromptAutocomplete();
      this.modelSetup = null;
      this.modelSetupText.setText("");
      this.promptInput.setSecretMode(false);
      this.promptInput.clear();
      this.addChatLine(advisorStatusLine(`Advisor: ${selectedModel}`));
      this.requestBottomAnchorRefresh();
      return;
    }

    const configuredBefore = countConfiguredProviders(state.config);
    const isNewProvider = !isStoredProviderConfigured(effectiveKey, state.existing ?? {});
    const credentialsOnly =
      configuredBefore >= 1 && isNewProvider && this.setupPurpose(state) === "worker";

    const providers = { ...(state.config.providers as Record<string, StoredProviderConfig | undefined>) };
    providers[effectiveKey] = {
      ...(state.existing ?? {}),
      ...(apiKey ? { apiKey } : {}),
      ...(state.baseUrl ? { baseUrl: state.baseUrl } : {}),
      ...(provider.customType ? { type: provider.customType } : {}),
    };
    state.config.providers = providers as Config["providers"];
    if (apiKey && provider.envVar) process.env[provider.envVar] = apiKey;

    await saveConfig(state.config);
    await saveHomeEnv(provider, apiKey, state.baseUrl);
    resetProviderManager();

    if (credentialsOnly) {
      if (this.modelSetupInputListener) {
        this.modelSetupInputListener();
        this.modelSetupInputListener = null;
      }
      this.restorePromptAutocomplete();
      this.modelSetup = null;
      this.modelSetupText.setText("");
      this.promptInput.setSecretMode(false);
      this.promptInput.clear();
      void this.emitStatusEvent(
        `Added ${provider.label} — worker model unchanged (${state.config.defaultModel})`
      );
      this.tui.requestRender();
      await this.openModelPicker({ purpose: "worker" });
      return;
    }

    state.config.defaultProvider = effectiveKey;
    state.config.defaultModel = selectedModel;
    state.config.modelExplicitlySet = true;
    await saveConfig(state.config);

    SessionManager.setOptions({ defaultModel: selectedModel });
    if (SessionManager.getCurrentSession()) {
      await SessionManager.update({ model: selectedModel });
    }
    await this.refreshActiveContextWindow(state.config, { discover: true });
    this.contextTokens = this.estimateCurrentSessionTokens();

    this.reasoningCapability = await this.reasoningCapabilityForProvider(effectiveKey);
    await this.normalizeReasoningLevel();
    void this.refreshReasoningCapability();
    // Save reasoning level if provided
    if (reasoningLevel) {
      void this.setReasoningLevel(reasoningLevel);
    }

    this.syncContextBar({
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
    this.restorePromptAutocomplete();
    this.modelSetup = null;
    this.modelSetupText.setText("");
    this.promptInput.setSecretMode(false);
    this.promptInput.clear();
    const reasonLabel = reasoningLevel ? ` (${this.reasoningDisplayLabel(reasoningLevel)})` : "";
    void this.emitStatusEvent(`Model changed to: ${selectedModel}${reasonLabel}`);
    this.tui.requestRender();
  }

  private async cmdUpdate(): Promise<void> {
    if (this.isRunning) {
      this.addChatLine(clr.warn("Wait for the current turn to finish."));
      return;
    }
    this.addChatLine(clr.dim("Checking for updates..."));
    this.tui.requestRender();
    const update = await checkForUpdate();
    if (!update) {
      this.addChatLine(modelStatusLine(`Already on latest (v${getCurrentVersion()}).`));
      this.tui.requestRender();
      return;
    }
    this.addChatLine(
      modelStatusLine(`Update available: v${update.currentVersion} -> v${update.latestVersion}`)
    );
    this.addChatLine(clr.dim("Installing update and relaunching..."));
    this.tui.requestRender();
    await SessionManager.flushCurrent();
    const session = SessionManager.getCurrentSession();
    if (session?.id) {
      writeUpdateResumeHint(session.id);
    }
    this.tui.stop();
    performUpdate(update.latestVersion);
    process.exit(0);
  }

  private setupPurpose(state: ModelSetupState): "worker" | "vision" | "advisor" | "subagent" {
    if (state.setupPurpose) return state.setupPurpose;
    if (state.isAdvisorMode) return "advisor";
    return "worker";
  }

  private syncDisplaySettingsFromConfig(config: Config): void {
    this.thinkingDisplay = config.thinkingDisplay ?? "summary";
    this.responsePreference = config.userProfile?.responsePreference?.trim() || "concise";
    this.compactToolOutputEnabled = config.compactToolOutput ?? true;
    this.applyThinkingDisplayMode();
  }

  /** Sync in-flight thinking block UI with thinkingDisplay (e.g. after /settings). */
  private applyThinkingDisplayMode(): void {
    if (!this.thinkingOpen || !this.thinkingText) return;

    if (this.thinkingDisplay === "full") {
      if (this.thinkingRaw.trim()) {
        this.thinkingText.setText(this.thinkingRaw);
      }
      this.thinkingText.setTruncateDisplay(this.thinkingTruncateDisplay());
    } else {
      this.thinkingText.setPlaceholder();
    }
  }

  private thinkingTruncateDisplay(): boolean {
    return this.responsePreference === "concise";
  }

  private appendWorkerThinking(text: string): void {
    this.setBusyStatus("Thinking ...", BUSY_PROCESSING);
    if (!this.thinkingOpen) {
      this.finalizeAssistantStreamingSegment(false);
      this.thinkingRaw = "";
      this.thinkingText = null;
    }
    if (!this.thinkingText) {
      this.addSectionGap();
      this.thinkingText = new ThinkingBlock();
      this.thinkingText.setTruncateDisplay(this.thinkingTruncateDisplay());
      this.chat.addChild(this.thinkingText);
      this.lastExpandableThinking = this.thinkingText;
      this.hasTrailingGap = false;
      this.thinkingOpen = true;
      this.thinkingStartedAt = Date.now();
    }
    const filtered = filterThinkingForDisplay(text);
    this.thinkingRaw += filtered;
    this.thinkingText.appendContent(filtered);
    if (this.thinkingDisplay !== "full") {
      this.thinkingText.setPlaceholder();
    } else {
      this.thinkingText.setTruncateDisplay(this.thinkingTruncateDisplay());
      this.thinkingText.setText(this.thinkingRaw);
    }
    this.noteLiveGeneration(text);
  }

  private setupTitle(state: ModelSetupState): string {
    const p = this.setupPurpose(state);
    if (p === "vision") return "VISION SETUP";
    if (p === "advisor") return "ADVISOR SETUP";
    if (p === "subagent") return "SUBAGENT MODEL SETUP";
    return "MODEL SETUP";
  }

  private async cmdModel(_arg: string): Promise<void> {
    if (this.isRunning) return;
    const config = await loadConfig();
    if (countConfiguredProviders(config) === 0) {
      await this.startModelSetup(config, "worker");
      return;
    }
    await this.openModelPicker({ purpose: "worker" });
  }

  private async openModelPicker(opts: {
    purpose: "worker" | "vision" | "subagent";
    onSubagentPicked?: (fullModel: string) => void | Promise<void>;
    onComplete?: () => void | Promise<void>;
  }): Promise<void> {
    try {
      const config = await loadConfig();
      const { buildModelPickerState, buildVisionModelPickerState, parseModelPickerSelection } =
        await import("./components/model-picker-overlay.js");

      const state =
        opts.purpose === "vision"
          ? await buildVisionModelPickerState(config, {
              maxHeight: LIST_OVERLAY_MAX_HEIGHT,
            })
          : await buildModelPickerState(config, {
              maxHeight: LIST_OVERLAY_MAX_HEIGHT,
            });

      if (state.configuredProviderCount === 0) {
        await this.startModelSetup(config, opts.purpose);
        return;
      }

      state.overlay.onSelect = async (compoundId: string) => {
        this.dismissListOverlay(this.modelPickerHandle);
        this.modelPickerHandle = null;
        const parsed = parseModelPickerSelection(compoundId);
        if (!parsed) {
          await opts.onComplete?.();
          return;
        }

        const fullModel = parsed.modelId.includes("/")
          ? parsed.modelId
          : modelWithProviderPrefix(parsed.providerKey, parsed.modelId);

        if (opts.purpose === "vision") {
          const cfg = await loadConfig();
          cfg.visionModel = fullModel;
          cfg.visionMode = true;
          await saveConfig(cfg);
          await this.persistSessionVision(true, fullModel);
          this.syncVisionFromConfig(await loadConfig());
          this.addChatLine(
            clr.dim(
              `Vision ON — ${fullModel.split("/").pop() ?? fullModel}`
            )
          );
        } else if (opts.purpose === "subagent") {
          const cfg = await loadConfig();
          cfg.subagentModel = fullModel;
          cfg.useSubagentModel = true;
          await saveConfig(cfg);
          await opts.onSubagentPicked?.(fullModel);
          this.addChatLine(modelStatusLine(`Subagent model: ${fullModel}`));
        } else {
          const cfg = await loadConfig();
          cfg.defaultProvider = parsed.providerKey;
          cfg.defaultModel = fullModel;
          cfg.modelExplicitlySet = true;
          await saveConfig(cfg);
          resetProviderManager();
          SessionManager.setOptions({ defaultModel: fullModel });
          await SessionManager.update({ model: fullModel });
          await this.refreshActiveContextWindow(cfg, { discover: true });
          this.contextTokens = this.estimateCurrentSessionTokens();
          void this.refreshReasoningCapability();
          this.syncContextBar({
            workerModel: fullModel,
            contextTokens: this.contextTokens,
            contextWindow: this.contextWindow,
          });
          this.addChatLine(modelStatusLine(`Model: ${fullModel}`));
        }
        this.tui.requestRender();
        await opts.onComplete?.();
      };

      state.overlay.onCancel = async () => {
        this.dismissListOverlay(this.modelPickerHandle);
        this.modelPickerHandle = null;
        this.tui.setFocus(this.promptInput);
        await opts.onComplete?.();
      };

      state.onRowsUpdated = () => this.tui.requestRender();

      state.overlay.onManageProviders = () => {
        this.dismissListOverlay(this.modelPickerHandle);
        this.modelPickerHandle = null;
        void this.startModelSetup(config, opts.purpose);
      };

      this.modelPickerHandle = this.showListOverlay(state.overlay);

      await state.discover();
      this.tui.requestRender();
    } catch (e) {
      this.addChatLine(
        clr.error(`Model selector failed: ${(e as Error).message}`)
      );
    }
  }

  private modelSetupInputListener: (() => void) | null = null;

  /** No-op autocomplete provider to clear model search after setup */
  private static readonly VOID_AUTOCOMPLETE = {
    getSuggestions: async () => null,
    applyCompletion: (ls: string[], cl: number, cc: number) => ({ lines: ls, cursorLine: cl, cursorCol: cc }),
  } as any;

  private restorePromptAutocomplete(): void {
    setAtAutocomplete(this.promptInput.getEditor(), () => process.cwd());
  }

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

      if (state.pendingRemoveProvider) {
        if (data === "\r") {
          const p = state.pendingRemoveProvider;
          delete state.pendingRemoveProvider;
          void this.removeConfiguredProvider(p).then(() => {
            void this.rebuildModelSetupProviders(state.config, this.setupPurpose(state));
          });
          return { consume: true };
        }
        if (data === "\x1b") {
          delete state.pendingRemoveProvider;
          delete state.error;
          this.renderModelSetup();
          return { consume: true };
        }
        return { consume: true };
      }

      if (data === "e" || data === "E") {
        const entry = state.providers[state.selectedIndex];
        if (entry?.configured) {
          state.editingProvider = true;
          void this.selectModelSetupProvider(entry.provider, { edit: true }).then(
            () => this.renderModelSetup()
          );
        }
        return { consume: true };
      }

      if (data === "d" || data === "D") {
        const entry = state.providers[state.selectedIndex];
        if (entry?.configured) {
          state.pendingRemoveProvider = entry.provider;
          this.renderModelSetup();
        }
        return { consume: true };
      }

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
          void this.selectModelSetupProvider(
            entry.provider,
            state.editingProvider ? { edit: true } : undefined
          );
        }
        return { consume: true };
      }
      return undefined;
    };

    this.modelSetupInputListener = this.tui.addInputListener(handleModelNav);
  }

  private async clearModelsUsingProvider(
    config: Config,
    providerKey: string
  ): Promise<void> {
    if (modelUsesProvider(config.defaultModel, providerKey)) {
      config.defaultModel = "";
      config.modelExplicitlySet = false;
    }
    if (modelUsesProvider(config.visionModel, providerKey)) {
      config.visionModel = undefined;
      config.visionMode = false;
      await this.persistSessionVision(false);
    }
    if (modelUsesProvider(config.advisorModel, providerKey)) {
      config.advisorModel = undefined;
      config.advisorMode = false;
      await this.persistSessionAdvisor(false);
    }
    await saveConfig(config);
    resetProviderManager();
    this.syncAdvisorFromConfig(config);
    this.syncVisionFromConfig(config);
    this.syncContextBar({
      workerModel: config.defaultModel,
      advisorModel: this.advisorModel,
      visionModel: this.visionModel,
      visionMode: config.visionMode ?? false,
    });
  }

  private async removeConfiguredProvider(
    provider: ModelProviderOption
  ): Promise<void> {
    const config = await loadConfig();
    const key = provider.isCustom
      ? provider.key
      : provider.key;
    const providers = {
      ...(config.providers as Record<string, StoredProviderConfig | undefined>),
    };
    delete providers[key];
    config.providers = providers as Config["providers"];
    await removeProviderFromHomeEnv(provider);
    await this.clearModelsUsingProvider(config, key);
    this.addChatLine(clr.dim(`Removed provider ${provider.label}`));
    this.tui.requestRender();
  }

  private async rebuildModelSetupProviders(
    config: Config,
    purpose: "worker" | "vision" | "advisor" | "subagent"
  ): Promise<void> {
    const configured: ProviderEntry[] = [];
    const unconfigured: ProviderEntry[] = [];
    for (const provider of MODEL_PROVIDERS) {
      const stored = providerConfig(config, provider.key);
      if (isStoredProviderConfigured(provider.key, stored)) {
        configured.push({
          provider,
          configured: true,
          valid: true,
          keyPreview: stored.apiKey ? maskKey(stored.apiKey) : (stored.baseUrl ?? "endpoint only"),
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
    const allProvs = config.providers as Record<
      string,
      { apiKey?: string; baseUrl?: string; type?: string }
    >;
    for (const [key, stored] of Object.entries(allProvs)) {
      if (MODEL_PROVIDERS.some((p) => p.key === key)) continue;
      if (!stored?.apiKey) continue;
      const cp: ModelProviderOption = {
        key,
        label: `Custom: ${key}`,
        envVar: "",
        defaultModel: config.defaultModel ?? "",
        modelBaseUrl: stored.baseUrl ?? "",
        ...(stored.baseUrl ? { defaultBaseUrl: stored.baseUrl } : {}),
        needsBaseUrl: false,
        isCustom: false,
        ...(stored.type
          ? { customType: stored.type as "openai-compatible" | "anthropic-compatible" }
          : {}),
      };
      configured.push({
        provider: cp,
        configured: true,
        valid: true,
        keyPreview: maskKey(stored.apiKey),
      });
    }

    if (configured.length === 0 && unconfigured.length > 0) {
      this.modelSetup = null;
      if (this.modelSetupInputListener) {
        this.modelSetupInputListener();
        this.modelSetupInputListener = null;
      }
      await this.startModelSetup(config, purpose);
      return;
    }

    if (!this.modelSetup) {
      await this.startModelSetup(config, purpose);
      return;
    }

    this.modelSetup.config = config;
    this.modelSetup.providers = [...configured, ...unconfigured];
    this.modelSetup.selectedIndex = 0;
    this.modelSetup.step = "provider";
    delete this.modelSetup.pendingRemoveProvider;
    this.renderModelSetup();
    void this.validateProviderKeys();
  }

  private async startModelSetup(
    config: Config,
    purpose: "worker" | "vision" | "advisor" | "subagent"
  ): Promise<void> {
    const configured: ProviderEntry[] = [];
    const unconfigured: ProviderEntry[] = [];
    for (const provider of MODEL_PROVIDERS) {
      const stored = providerConfig(config, provider.key);
      if (isStoredProviderConfigured(provider.key, stored)) {
        configured.push({
          provider,
          configured: true,
          valid: true,
          keyPreview: stored.apiKey ? maskKey(stored.apiKey) : (stored.baseUrl ?? "endpoint only"),
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
    const allProvs = config.providers as Record<
      string,
      { apiKey?: string; baseUrl?: string; type?: string }
    >;
    for (const [key, stored] of Object.entries(allProvs)) {
      if (MODEL_PROVIDERS.some((p) => p.key === key)) continue;
      if (!stored?.apiKey) continue;
      const cp: ModelProviderOption = {
        key,
        label: `Custom: ${key}${stored.type ? ` (${stored.type === "anthropic-compatible" ? "Anthropic" : "OpenAI"})` : ""}`,
        envVar: "",
        defaultModel: config.defaultModel ?? "",
        modelBaseUrl: stored.baseUrl ?? "",
        ...(stored.baseUrl ? { defaultBaseUrl: stored.baseUrl } : {}),
        needsBaseUrl: false,
        isCustom: false,
        ...(stored.type
          ? { customType: stored.type as "openai-compatible" | "anthropic-compatible" }
          : {}),
      };
      configured.push({
        provider: cp,
        configured: true,
        valid: true,
        keyPreview: maskKey(stored.apiKey),
      });
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
      setupPurpose: purpose,
      isAdvisorMode: purpose === "advisor",
    };

    this.promptInput.clear();
    this.promptInput.setSecretMode(false);
    this.autocompleteText.setText("");
    this.setupModelNavigation();
    this.renderModelSetup();
    void this.validateProviderKeys();
  }

  private async cmdUsage(): Promise<void> {
    const session = SessionManager.getCurrentSession();
    const config = await loadConfig();
    const tokens = this.contextTokens;
    const window = this.contextWindow;
    const pct =
      window > 0 ? Math.round((tokens / window) * 100) : 0;
    this.addChatLine(
      clr.dim(`Session: ~${tokens} / ${window} tokens (${pct}%) · ${session?.messages.length ?? 0} messages`)
    );
    if (config.statsOnExit && session) {
      for (const line of formatSessionStatsBlock(collectSessionStats(session))) {
        this.addChatLine(clr.dim(line));
      }
    }
    const repairs = getRepairTelemetrySummary();
    if (repairs.length > 0) {
      const top = repairs.slice(0, 5).map((r) => `${r.tool}/${r.repairType}×${r.count}`);
      this.addChatLine(clr.dim(`Tool input repairs: ${top.join(", ")}`));
    }
    this.tui.requestRender();
  }

  private async cmdCheckpoint(): Promise<void> {
    if (!this.experimentalUndoEnabled) {
      this.addChatLine(clr.warn("Checkpoint requires /experimental → undo"));
      this.tui.requestRender();
      return;
    }
    const session = SessionManager.getCurrentSession();
    if (!session || session.messages.length === 0) {
      this.addChatLine(clr.warn("No messages to checkpoint"));
      this.tui.requestRender();
      return;
    }
    const lastUser = [...session.messages].reverse().find((m) => m.role === "user");
    const summary = lastUser?.content.slice(0, 100);
    const ok = await SessionManager.createCheckpoint(summary);
    if (!ok) {
      this.addChatLine(clr.warn("Checkpoint failed (not a git repo or no changes)"));
    } else {
      const index = session.messages.length - 1;
      void this.emitStatusEvent(`Checkpoint saved at message ${index}`);
    }
    this.tui.requestRender();
  }

  private async cmdUndo(arg: string): Promise<void> {
    if (!this.experimentalUndoEnabled) {
      this.addChatLine(clr.warn("Undo requires /experimental → undo"));
      this.tui.requestRender();
      return;
    }
    const sessionID = SessionManager.getCurrentSessionID();
    if (!sessionID) {
      this.addChatLine(clr.warn("No active session"));
      this.tui.requestRender();
      return;
    }
    const checkpoints = await CheckpointManager.listCheckpoints(sessionID);
    if (checkpoints.length === 0) {
      this.addChatLine(clr.warn("No checkpoints available"));
      this.tui.requestRender();
      return;
    }
    const indexArg = arg.match(/--index\s+(\d+)/)?.[1];
    const targetIndex = indexArg
      ? Number.parseInt(indexArg, 10)
      : Math.max(0, checkpoints.length - 2);
    const ok = await CheckpointManager.undoToCheckpoint(sessionID, targetIndex);
    if (!ok) {
      this.addChatLine(clr.error("Failed to undo to checkpoint"));
      this.tui.requestRender();
      return;
    }
    const session = SessionManager.getCurrentSession();
    if (session) {
      const trimmed = session.messages.slice(0, targetIndex + 1);
      await SessionManager.update({ messages: trimmed, headerTitle: `Reverted: ${session.headerTitle ?? session.name}` });
    }
    this.resetTurnUiState();
    this.clearChatView();
    const updated = SessionManager.getCurrentSession()!;
    this.loadGoalFromSession(updated);
    this.hydrateChatFromSession(updated);
    void this.emitStatusEvent(`Reverted to checkpoint ${targetIndex}`);
    this.tui.requestRender();
  }

  private async cmdRedo(arg: string): Promise<void> {
    if (!this.experimentalUndoEnabled) {
      this.addChatLine(clr.warn("Redo requires /experimental → undo"));
      this.tui.requestRender();
      return;
    }
    const sessionID = SessionManager.getCurrentSessionID();
    if (!sessionID) {
      this.addChatLine(clr.warn("No active session"));
      this.tui.requestRender();
      return;
    }
    const checkpoints = await CheckpointManager.listCheckpoints(sessionID);
    if (checkpoints.length === 0) {
      this.addChatLine(clr.warn("No checkpoints available"));
      this.tui.requestRender();
      return;
    }
    const indexArg = arg.match(/--index\s+(\d+)/)?.[1];
    const targetIndex = indexArg
      ? Number.parseInt(indexArg, 10)
      : checkpoints.length - 1;
    const ok = await CheckpointManager.redoToCheckpoint(sessionID, targetIndex);
    if (!ok) {
      this.addChatLine(clr.error("Failed to redo to checkpoint"));
      this.tui.requestRender();
      return;
    }
    const session = SessionManager.getCurrentSession();
    if (session) {
      const trimmed = session.messages.slice(0, targetIndex + 1);
      await SessionManager.update({ messages: trimmed, headerTitle: `Reapplied: ${session.headerTitle ?? session.name}` });
    }
    this.resetTurnUiState();
    this.clearChatView();
    const updated = SessionManager.getCurrentSession()!;
    this.loadGoalFromSession(updated);
    this.hydrateChatFromSession(updated);
    void this.emitStatusEvent(`Reapplied checkpoint ${targetIndex}`);
    this.tui.requestRender();
  }

  private async cmdGoal(arg: string): Promise<void> {
    if (!this.experimentalGoalEnabled) {
      this.addChatLine(clr.warn("Goal loop requires /experimental → goal"));
      this.tui.requestRender();
      return;
    }
    const sub = arg.trim().toLowerCase();
    if (!sub) {
      this.addChatLine(clr.dim("Usage: /goal <text> | status | pause | resume | clear"));
      this.tui.requestRender();
      return;
    }
    if (sub === "status") {
      if (!this.goalState) {
        this.addChatLine(clr.dim("No active goal"));
      } else {
        this.addChatLine(
          clr.dim(
            `${this.goalState.status} — ${this.goalState.turnsUsed}/${this.goalState.maxTurns} turns: ${this.goalState.text}`
          )
        );
      }
      this.tui.requestRender();
      return;
    }
    if (sub === "clear") {
      this.goalState = undefined;
      await this.persistGoalState();
      this.syncGoalContextBar();
      void this.emitStatusEvent("Goal cleared");
      this.tui.requestRender();
      return;
    }
    if (sub === "pause") {
      if (this.goalState) {
        this.goalState = { ...this.goalState, status: "paused" };
        await this.persistGoalState();
        this.syncGoalContextBar();
        void this.emitStatusEvent("Goal paused");
      }
      this.tui.requestRender();
      return;
    }
    if (sub === "resume") {
      if (this.goalState) {
        this.goalState = {
          ...this.goalState,
          status: "active",
          turnsUsed: 0,
        };
        await this.persistGoalState();
        this.syncGoalContextBar();
        void this.emitStatusEvent("Goal resumed — turn counter reset");
      }
      this.tui.requestRender();
      return;
    }
    if (this.isRunning) {
      this.addChatLine(clr.warn("Cannot set goal during an active turn"));
      this.tui.requestRender();
      return;
    }
    this.goalState = createGoalState(arg.trim());
    await this.persistGoalState();
    this.syncGoalContextBar();
    void this.emitStatusEvent(`Goal set: ${this.goalState.text}`);
    this.tui.requestRender();
  }

  private async cmdExperimental(): Promise<void> {
    if (this.isRunning || !this.tui) return;
    const config = await loadConfig();
    const overlay = new ExperimentalOverlay({
      flags: {
        advisor: config.experimental?.advisor ?? false,
        undo: config.experimental?.undo ?? false,
        goal: config.experimental?.goal ?? false,
      },
    });

    await new Promise<void>((resolve) => {
      const handle = this.showContentSizedOverlay(overlay, { maxHeight: 16 });
      this.experimentalOverlayHandle = handle;

      const cleanupNav = this.tui.addInputListener((data: string) => {
        overlay.handleInput(data);
        this.tui.requestRender();
        return { consume: true };
      });

      const finish = () => {
        cleanupNav();
        this.dismissExperimentalOverlay();
        this.tui.setFocus(this.promptInput);
        resolve();
      };

      overlay.onAbort = () => {
        finish();
      };

      overlay.onSubmit = (flags) => {
        void (async () => {
          config.experimental = {
            advisor: flags.advisor,
            undo: flags.undo,
            goal: flags.goal,
          };
          if (!flags.advisor) {
            config.advisorMode = false;
            await this.persistSessionAdvisor(false);
            this.syncAdvisorFromConfig(config);
            this.syncContextBar({ advisorModel: undefined });
          }
          if (!flags.goal) {
            this.goalState = undefined;
            await this.persistGoalState();
          }
          await saveConfig(config);
          this.experimentalAdvisorEnabled = flags.advisor;
          this.experimentalUndoEnabled = flags.undo;
          this.experimentalGoalEnabled = flags.goal;
          void this.emitStatusEvent(
            `Experimental — advisor ${flags.advisor ? "on" : "off"}, undo ${flags.undo ? "on" : "off"}, goal ${flags.goal ? "on" : "off"}`
          );
          if (flags.advisor && !config.advisorModel) {
            this.addChatLine(clr.dim("Configure advisor model via /advisor"));
          }
          finish();
          this.requestBottomAnchorRefresh();
        })();
      };
    });
  }

  private dismissExperimentalOverlay(): void {
    this.experimentalOverlayHandle?.hide();
    this.experimentalOverlayHandle = null;
  }

  private dismissSettingsOverlay(): void {
    this.settingsInputCleanup?.();
    this.settingsInputCleanup = null;
    this.settingsOverlayHandle?.hide();
    this.settingsOverlayHandle = null;
  }

  private async cmdSettings(): Promise<void> {
    if (this.isRunning || !this.tui) return;
    const config = await loadConfig();

    const initialValues: SettingsValues = {
      thinkingDisplay: config.thinkingDisplay ?? "summary",
      reasoningLevel: config.reasoningLevel ?? "medium",
      responsePreference: config.userProfile?.responsePreference?.trim() || "concise",
      statsOnExit: config.statsOnExit ?? false,
      showSubagentThinking: config.showSubagentThinking,
      useSubagentModel: config.useSubagentModel,
      compactToolOutput: config.compactToolOutput ?? true,
      ...(config.subagentModel !== undefined ? { subagentModel: config.subagentModel } : {}),
      ...(config.visionModelOverride !== undefined
        ? { visionModelOverride: config.visionModelOverride }
        : {}),
    };

    const overlay = new SettingsOverlay({ values: initialValues });

    const applySettingsValues = async (
      values: SettingsValues
    ): Promise<"saved" | "unchanged"> => {
      if (settingsValuesEqual(values, initialValues)) {
        return "unchanged";
      }
      config.thinkingDisplay = values.thinkingDisplay;
      config.showMainThinking = values.thinkingDisplay === "full";
      config.reasoningLevel = values.reasoningLevel;
      config.statsOnExit = values.statsOnExit;
      config.showSubagentThinking = values.showSubagentThinking;
      config.useSubagentModel = values.useSubagentModel;
      config.compactToolOutput = values.compactToolOutput;
      config.visionModelOverride = values.visionModelOverride;
      if (values.subagentModel !== undefined) {
        config.subagentModel = values.subagentModel;
      }
      if (!config.userProfile) {
        config.userProfile = { name: "", responsePreference: "concise", customInstructions: "" };
      }
      config.userProfile.responsePreference = values.responsePreference;
      await saveConfig(config);
      invalidatePromptCache();
      this.reasoningLevel = values.reasoningLevel;
      this.syncDisplaySettingsFromConfig(config);
      this.syncContextBar({ reasoningLevel: this.reasoningDisplayLabel() });
      return "saved";
    };

    await new Promise<void>((resolve) => {
      const handle = this.showContentSizedOverlay(overlay, { maxHeight: 20 });
      this.settingsOverlayHandle = handle;

      const cleanupNav = this.tui.addInputListener((data: string) => {
        overlay.handleInput(data);
        this.tui.requestRender();
        return { consume: true };
      });
      this.settingsInputCleanup = cleanupNav;

      const finish = () => {
        this.dismissSettingsOverlay();
        this.tui.setFocus(this.promptInput);
        this.tui.requestRender();
        resolve();
      };

      const openSubagentPicker = () => {
        void (async () => {
          await applySettingsValues(overlay.getValues());

          this.dismissSettingsOverlay();
          if (countConfiguredProviders(await loadConfig()) === 0) {
            await this.startModelSetup(await loadConfig(), "subagent");
            finish();
          } else {
            await this.openModelPicker({ 
              purpose: "subagent",
              onSubagentPicked: async () => {
                this.tui.setFocus(this.promptInput);
                this.tui.requestRender();
              },
              onComplete: () => {
                finish();
              }
            });
          }
        })();
      };

      overlay.onAbort = () => finish();

      overlay.onEnableSubagentModel = openSubagentPicker;
      overlay.onPickSubagentModel = openSubagentPicker;

      overlay.onPickVisionOverride = () => {
        void (async () => {
          await applySettingsValues(overlay.getValues());
          this.dismissSettingsOverlay();
          finish();
          await this.openModelPicker({
            purpose: "vision",
            onComplete: async () => {
              const cfg = await loadConfig();
              if (cfg.visionModel?.trim()) {
                cfg.visionModelOverride = cfg.visionModel;
                await saveConfig(cfg);
                void this.emitStatusEvent(`Vision override: ${cfg.visionModel}`);
              }
            },
          });
        })();
      };

      overlay.onClearVisionOverride = () => {
        overlay.setVisionModelOverride(undefined);
      };

      overlay.onSubmit = (values) => {
        void (async () => {
          const result = await applySettingsValues(values);
          void this.emitStatusEvent(
            result === "saved" ? "Settings saved" : "Settings unchanged"
          );
          finish();
        })();
      };
    });
  }

  private async cmdAdvisor(arg: string): Promise<void> {
    if (this.isRunning) return;
    const config = await loadConfig();

    if (!this.experimentalAdvisorEnabled) {
      this.addChatLine(
        `${clr.warn("!")} Advisor is experimental. Run ${clr.tool("/experimental")} to enable.`
      );
      this.tui.requestRender();
      return;
    }

    // /advisor off ? toggle OFF
    if (arg === "off") {
      config.advisorMode = false;
      await saveConfig(config);
      await this.persistSessionAdvisor(false);
      this.syncAdvisorFromConfig(await loadConfig());
      this.syncContextBar({
        advisorModel: undefined,
        workerModel: config.defaultModel,
        contextTokens: this.contextTokens,
        contextWindow: this.contextWindow,
        mode: this.mode,
      });
      this.addChatLine(advisorStatusLine("Advisor mode disabled"));
      return;
    }

    // If already ON, /advisor or /advisor on toggles it OFF
    if (config.advisorMode && (arg === "" || arg === "on")) {
      config.advisorMode = false;
      await saveConfig(config);
      await this.persistSessionAdvisor(false);
      this.syncAdvisorFromConfig(await loadConfig());
      this.syncContextBar({
        advisorModel: undefined,
        workerModel: config.defaultModel,
        contextTokens: this.contextTokens,
        contextWindow: this.contextWindow,
        mode: this.mode,
      });
      this.addChatLine(advisorStatusLine("Advisor mode disabled"));
      return;
    }

    // Direct model string: /advisor openrouter/anthropic/claude-opus-4.7
    if (arg && arg !== "on") {
      config.advisorModel = arg;
      config.advisorMode = true;
      await saveConfig(config);
      await this.persistSessionAdvisor(true, arg);
      this.syncAdvisorFromConfig(await loadConfig());
      this.advisorModel = arg;
      this.syncContextBar({ advisorModel: arg });
      this.addChatLine(advisorStatusLine(`Advisor: ${arg} (mode ON)`));
      return;
    }

    if (countConfiguredProviders(config) === 0) {
      await this.startModelSetup(config, "advisor");
      return;
    }

    await this.openAdvisorModelPicker();
  }

  private async openAdvisorModelPicker(): Promise<void> {
    const config = await loadConfig();
    const { buildModelPickerState, parseModelPickerSelection } = await import(
      "./components/model-picker-overlay.js"
    );
    const state = await buildModelPickerState(config, {
      maxHeight: LIST_OVERLAY_MAX_HEIGHT,
      title: "Switch advisor model",
    });

    if (state.configuredProviderCount === 0) {
      await this.startModelSetup(config, "advisor");
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
      const cfg = await loadConfig();
      cfg.advisorModel = fullModel;
      cfg.advisorMode = true;
      await saveConfig(cfg);
      await this.persistSessionAdvisor(true, fullModel);
      this.syncAdvisorFromConfig(await loadConfig());
      this.addChatLine(advisorStatusLine(`Advisor: ${fullModel} (mode ON)`));
      this.tui.requestRender();
    };

    state.overlay.onCancel = () => {
      this.dismissListOverlay(this.modelPickerHandle);
      this.modelPickerHandle = null;
      this.tui.setFocus(this.promptInput);
    };

    state.overlay.onManageProviders = () => {
      this.dismissListOverlay(this.modelPickerHandle);
      this.modelPickerHandle = null;
      void this.startModelSetup(config, "advisor");
    };

    state.onRowsUpdated = () => this.tui.requestRender();
    this.modelPickerHandle = this.showListOverlay(state.overlay);
    await state.discover();
    this.tui.requestRender();
  }

  private async cmdShow(): Promise<void> {
    const session = SessionManager.getCurrentSession();
    if (!session?.messages?.length) {
      this.addChatLine(clr.dim("No messages in this session to show."));
      this.tui.requestRender();
      return;
    }

    this.resetTurnUiState();
    this.clearChatView();
    this.hydrateChatFromSession(session);
    this.addChatLine(clr.dim("Chat restored from session history"));
    this.tui.requestRender();
  }

  private cmdMode(arg: string): void {
    if (!arg) {
      if (isDefaultMode(this.mode)) {
        this.addChatLine(
          `  default mode (AGENT)  |  explicit: EXPLORE | PLAN | DEBUG  |  Tab to cycle`
        );
      } else {
        this.addChatLine(
          `  mode: ${displayModeLabel(this.mode)}  |  options: ${displayModeOptions()}`
        );
      }
      return;
    }
    const m = normalizeMode(arg.toUpperCase()) as Mode;
    if (MODE_CYCLE.includes(m)) {
      const prev = this.mode;
      this.applyModeChange(m, { prev, transition: "chat" });
      this.tui.requestRender();
    } else {
      this.addChatLine(`  ${clr.error("!")} Unknown mode. Options: ${displayModeOptions()}`);
    }
  }

  private syncAllowAllBypassUi(): void {
    this.syncContextBar({ allowAllBypass: isAllowAllBypass() });
    this.tui?.requestRender();
  }

  private syncSpeedoUi(): void {
    this.syncContextBar({
      showTurnSpeed: this.speedoEnabled,
      ...(!this.speedoEnabled
        ? { tokensPerSecond: undefined, lastTurnMs: undefined }
        : {}),
    });
    this.tui?.requestRender();
  }

  private dismissAllowAllDisclaimer(): void {
    this.allowAllDisclaimerHandle?.hide();
    this.allowAllDisclaimerHandle = null;
  }

  private showAllowAllDisclaimer(): Promise<boolean> {
    if (!this.tui) return Promise.resolve(false);

    return new Promise<boolean>((resolve) => {
      this.dismissAllowAllDisclaimer();

      const overlay = new AllowAllDisclaimerOverlay();
      const handle = this.tui.showOverlay(overlay, {
        anchor: "bottom-center",
        offsetY: -4,
        width: "92%",
        minWidth: this.overlayMin(),
        maxHeight: 16,
        margin: { left: 2, right: 2, bottom: 4 },
      });
      this.allowAllDisclaimerHandle = handle;
      handle.focus();

      overlay.onDecision = (decision) => {
        this.dismissAllowAllDisclaimer();
        this.tui.setFocus(this.promptInput);
        resolve(decision === "agree");
      };
    });
  }

  private async cmdAllowAll(arg: string): Promise<void> {
    if (this.isRunning) {
      this.addChatLine(clr.warn("Wait for the current turn to finish."));
      this.tui.requestRender();
      return;
    }

    if (arg) {
      this.addChatLine(
        `  ${clr.dim("/allow-all is a toggle only — run /allow-all with no arguments.")}`
      );
      this.tui.requestRender();
      return;
    }

    if (isAllowAllBypass()) {
      setAllowAllBypass(false);
      this.syncAllowAllBypassUi();
      this.addChatLine(clr.dim("Permission bypass off"));
      this.tui.requestRender();
      return;
    }

    const agreed = await this.showAllowAllDisclaimer();
    if (!agreed) {
      this.addChatLine(clr.dim("Allow-all not enabled."));
      this.tui.requestRender();
      return;
    }

    setAllowAllBypass(true);
    this.syncAllowAllBypassUi();
    this.addChatLine(clr.dim("All permissions bypassed"));
    this.tui.requestRender();
  }

  private async cmdUser(_arg: string): Promise<void> {
    if (this.isRunning) return;

    const config = await loadConfig();
    const overlay = new ProfileOverlay(
      config.userProfile !== undefined ? { profile: config.userProfile } : {}
    );

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
      this.addChatLine(clr.dim("Profile updated"));
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
    this.taskCodenames.clear();
    if (this.diffRevealInterval) {
      clearInterval(this.diffRevealInterval);
      this.diffRevealInterval = null;
    }
    this.dismissTaskBatchPermissionOverlay();
    this.clearCtrlCPending();
    this.streamingRaw = "";
    this.streamingText = null;
    this.thinkingRaw = "";
    this.thinkingText = null;
    this.thinkingOpen = false;
    this.thinkingStartedAt = 0;
    this.thinkingElapsedMs = 0;
    this.lastBandWasTool = false;
    this.lastBandToolHadBody = false;
  }

  private syncAdvisorFromConfig(config: Config): void {
    const active =
      config.advisorMode &&
      this.experimentalAdvisorEnabled &&
      Boolean(config.advisorModel?.trim());
    this.advisorModel = active ? config.advisorModel : undefined;
  }

  private syncVisionFromConfig(config: Config): void {
    const active = config.visionMode && Boolean(config.visionModel?.trim());
    this.visionModel = active ? config.visionModel : undefined;
    this.syncContextBar({
      visionModel: this.visionModel,
      visionMode: config.visionMode ?? false,
    });
  }

  private async persistSessionAdvisor(
    advisorMode: boolean,
    advisorModel?: string
  ): Promise<void> {
    if (!SessionManager.getCurrentSession()) return;
    await SessionManager.update({
      advisorMode,
      advisorModel: advisorMode ? advisorModel : undefined,
    });
  }

  private async persistSessionVision(
    visionMode: boolean,
    visionModel?: string
  ): Promise<void> {
    if (!SessionManager.getCurrentSession()) return;
    await SessionManager.update({
      visionMode,
      visionModel: visionMode ? visionModel : undefined,
    });
  }

  private sideOverlayMaxHeight(): number {
    const rows = this.tui?.terminal?.rows ?? 24;
    const cap = Math.floor(rows * 0.55);
    return Math.min(50, Math.max(14, cap));
  }

  private dismissSideOverlay(): void {
    this.sideAbortController?.abort();
    this.sideAbortController = null;
    this.sideStreamActive = false;
    this.sideInputCleanup?.();
    this.sideInputCleanup = null;
    this.sideOverlayHandle?.hide();
    this.sideOverlayHandle = null;
    this.sideOverlay = null;
    this.currentSideExchangeId = null;
    this.tui.setFocus(this.promptInput);
    this.tui.requestRender();
  }

  private mountSideOverlay(overlay: SideOverlay): void {
    this.dismissSideOverlay();
    this.sideOverlay = overlay;

    const maxHeight = this.sideOverlayMaxHeight();
    overlay.onCancel = () => this.dismissSideOverlay();
    overlay.onScroll = () => this.tui.requestRender();
    overlay.onCopy = () => this.handleSideCopy();

    overlay.onOpenDetail = (exchange) => {
      this.showSideHistoryDetail(exchange);
    };
    overlay.onBackToList = () => {
      this.showSideHistoryOverlay();
    };

    this.sideInputCleanup = this.tui.addInputListener((data: string) => {
      if (data === "\x1b") {
        this.dismissSideOverlay();
        return { consume: true };
      }
      overlay.handleInput(data);
      this.tui.requestRender();
      return { consume: true };
    });

    this.sideOverlayHandle = this.showContentSizedOverlay(overlay, {
      maxHeight,
    });
    this.tui.requestRender();
  }

  private handleSideCopy(): void {
    const overlay = this.sideOverlay;
    if (!overlay) return;

    let userText = "";
    let assistantText = "";
    let exchangeId: string | null = this.currentSideExchangeId;

    if (overlay.mode === "live") {
      const live = overlay.getLiveState();
      if (!live?.complete || !live.answerText.trim()) {
        this.addChatLine(clr.dim("Side prompt not ready to copy yet"));
        this.tui.requestRender();
        return;
      }
      userText = live.userText;
      assistantText = live.answerText;
    } else if (overlay.mode === "history-detail") {
      const ex = overlay.getDetailExchange();
      if (!ex?.assistantText.trim()) {
        this.addChatLine(clr.dim("Side prompt not ready to copy yet"));
        this.tui.requestRender();
        return;
      }
      userText = ex.userText;
      assistantText = ex.assistantText;
      exchangeId = ex.id;
    } else {
      return;
    }

    const block = formatSideCopyMarkdown(userText, assistantText);
    this.promptInput.injectSideCopyBlock(block);
    this.tui.setFocus(this.promptInput);

    if (exchangeId) {
      void SessionManager.markSideExchangeCopied(exchangeId);
    }
    this.tui.requestRender();
  }

  private showSideHistoryOverlay(): void {
    const session = SessionManager.getCurrentSession();
    const exchanges = session?.sideExchanges ?? [];
    const overlay = new SideOverlay({
      mode: "history-list",
      maxHeight: this.sideOverlayMaxHeight(),
      exchanges,
    });
    this.mountSideOverlay(overlay);
  }

  private showSideHistoryDetail(exchange: SideExchange): void {
    const overlay = new SideOverlay({
      mode: "history-detail",
      maxHeight: this.sideOverlayMaxHeight(),
      exchanges: SessionManager.getCurrentSession()?.sideExchanges ?? [],
    });
    overlay.openDetail(exchange);
    this.currentSideExchangeId = exchange.id;
    this.mountSideOverlay(overlay);
  }

  private async cmdSide(arg: string): Promise<void> {
    const parsed = parseSideSlashArgs(arg);

    if (parsed.kind === "usage") {
      this.addChatLine(
        clr.dim(
          "Usage: /side <question>  |  /side -c <question>  |  /side --history"
        )
      );
      this.tui.requestRender();
      return;
    }

    if (parsed.kind === "history") {
      this.showSideHistoryOverlay();
      return;
    }

    if (this.sideStreamActive) {
      this.addChatLine(clr.dim("A side prompt is already open — Esc to close it first."));
      this.tui.requestRender();
      return;
    }

    if (!this.isRunning) {
      this.addChatLine(
        clr.dim("No active turn — /side <question> applies during an agent turn")
      );
      this.tui.requestRender();
      return;
    }

    await this.startSidePrompt(parsed.question, parsed.useContext);
  }

  private async startSidePrompt(question: string, useContext: boolean): Promise<void> {
    const session = SessionManager.getCurrentSession();
    if (!session) {
      this.addChatLine(clr.dim("No active session."));
      this.tui.requestRender();
      return;
    }

    const config = await loadConfig();
    const model =
      session.model?.trim() || config.defaultModel?.trim() || "";
    if (!model) {
      this.addChatLine(clr.dim("No model configured — use /model first."));
      this.tui.requestRender();
      return;
    }

    const contextSnapshot = useContext
      ? buildSideContextSnapshot(session.messages)
      : undefined;

    const live = SideOverlay.liveInitial(question, {
      ...(contextSnapshot !== undefined ? { contextSnapshot } : {}),
      usedContext: useContext && Boolean(contextSnapshot?.trim()),
    });

    const overlay = new SideOverlay({
      mode: "live",
      maxHeight: this.sideOverlayMaxHeight(),
      live,
    });
    this.mountSideOverlay(overlay);

    const exchangeId = `side_${crypto.randomUUID()}`;
    this.currentSideExchangeId = exchangeId;
    this.sideAbortController = new AbortController();
    this.sideStreamActive = true;
    const signal = this.sideAbortController.signal;
    const reasoningLevel =
      config.reasoningLevel ?? (config.thinking ? "medium" : "off");

    try {
      const result = await runSideChat({
        model,
        userText: question,
        useContext: live.usedContext,
        ...(contextSnapshot !== undefined ? { contextSnapshot } : {}),
        reasoningLevel,
        signal,
        events: {
          onToken: (text) => {
            this.sideOverlay?.appendAnswer(text);
            this.tui.requestRender();
          },
          onThinking: (text) => {
            this.sideOverlay?.appendThinking(text);
            this.tui.requestRender();
          },
        },
      });

      this.sideOverlay?.setComplete();

      if (!result.aborted && (result.assistantText.trim() || result.thinkingText.trim())) {
        const exchange: SideExchange = {
          id: exchangeId,
          createdAt: new Date().toISOString(),
          userText: question,
          assistantText: result.assistantText,
          usedContext: live.usedContext,
          ...(result.thinkingText.trim() ? { thinkingText: result.thinkingText } : {}),
          ...(live.usedContext && contextSnapshot !== undefined
            ? { contextSnapshot }
            : {}),
        };
        await SessionManager.appendSideExchange(exchange);
      }
    } catch (e) {
      this.sideOverlay?.appendAnswer(
        `\n[Side prompt error: ${e instanceof Error ? e.message : String(e)}]`
      );
      this.sideOverlay?.setComplete();
    } finally {
      this.sideStreamActive = false;
      this.sideAbortController = null;
      this.tui.requestRender();
    }
  }

  private helpOverlayMaxHeight(): number {
    const rows = this.tui?.terminal?.rows ?? 24;
    const reserved = 8;
    return Math.min(50, Math.max(20, rows - reserved));
  }

  private dismissHelpOverlay(): void {
    this.helpInputCleanup?.();
    this.helpInputCleanup = null;
    this.helpOverlayHandle?.hide();
    this.helpOverlayHandle = null;
    this.tui.setFocus(this.promptInput);
    this.tui.requestRender();
  }

  private showHelpOverlay(): void {
    if (this.isRunning) return;

    this.dismissHelpOverlay();

    const maxHeight = this.helpOverlayMaxHeight();
    const overlay = new HelpOverlay({
      opts: {
        experimentalAdvisor: this.experimentalAdvisorEnabled,
        experimentalUndo: this.experimentalUndoEnabled,
        experimentalGoal: this.experimentalGoalEnabled,
      },
      maxHeight,
    });
    overlay.onCancel = () => this.dismissHelpOverlay();
    overlay.onScroll = () => {
      this.tui.requestRender();
    };

    this.helpInputCleanup = this.tui.addInputListener((data: string) => {
      if (data === "\x1b") {
        this.dismissHelpOverlay();
        return { consume: true };
      }
      overlay.handleInput(data);
      this.tui.requestRender();
      return { consume: true };
    });

    this.helpOverlayHandle = this.showContentSizedOverlay(overlay, {
      maxHeight,
    });
    this.tui.requestRender();
  }

  private applySessionToRenderer(session: import("../session/store.js").Session): void {
    const mode = normalizeMode(session.mode) as Mode;
    this.mode = mode;
    setCurrentMode(mode);
    this.syncModeColor();
    this.speedoEnabled = false;
    this.syncSpeedoUi();

    if (session.model) {
      this.syncContextBar({ workerModel: session.model });
    }
    if (session.context_window) {
      this.contextWindow = session.context_window;
    }
    this.contextTokens = this.estimateCurrentSessionTokens();
    this.loadGoalFromSession(session);
    void loadConfig().then(async (cfg) => {
      this.syncAdvisorFromConfig(cfg);
      this.syncVisionFromConfig(cfg);
      await this.refreshActiveContextWindow(cfg, { discover: true });
      this.contextTokens = this.estimateCurrentSessionTokens();
      this.syncContextBar({
        mode: this.mode,
        contextTokens: this.contextTokens,
        contextWindow: this.contextWindow,
        advisorModel: this.advisorModel,
        visionModel: this.visionModel,
        visionMode: cfg.visionMode ?? false,
        ...(session.model ? { workerModel: session.model } : {}),
      });
      this.tui.requestRender();
    });
  }

  private showSessionRestored(session: Session): void {
    const title = session.headerTitle ?? session.name;
    this.addChatLine(clr.dim(`${GUTTER}${clr.bold("impulse")} ${clr.dim("|")} ${title}`));
    this.addChatLine(clr.dim("Session restored"));
    this.addSectionGap();
  }

  private hydrateChatFromSession(session: Session): void {
    this.lastBandWasTool = false;
    this.lastBandToolHadBody = false;
    const steps = buildReplaySteps(session.messages);
    for (const step of steps) {
      this.appendReplayStep(step);
    }
  }

  private appendReplayStep(step: ReplayStep): void {
    switch (step.type) {
      case "status":
        this.addChatLine(clr.dim(step.text));
        break;
      case "user":
        this.addSectionGap();
        this.addChatLine(`${A.fg(36, this.userName)}`);
        this.addChatLine(step.text);
        this.addSectionGap();
        break;
      case "injected":
        this.addSectionGap();
        this.addChatLine(clr.dim(`[system note] ${step.text}`));
        this.addSectionGap();
        break;
      case "thinking": {
        const filtered = filterThinkingForDisplay(step.text);
        if (!filtered.trim()) break;
        this.addSectionGap();
        const block = new ThinkingBlock();
        block.setTruncateDisplay(this.thinkingTruncateDisplay());
        block.setText(filtered);
        block.finalize(step.durationMs ?? 0);
        if (this.thinkingDisplay === "full") {
          block.setExpanded(true);
        }
        this.chat.addChild(block);
        this.hasTrailingGap = false;
        break;
      }
      case "assistantText":
        this.chat.addChild(new Text(`${GUTTER}${A.fg(33, "impulse")}${A.reset}`, 0, 0));
        this.hasTrailingGap = false;
        {
          const md = new MarkdownTextBlock(GUTTER);
          md.setText(step.text);
          this.chat.addChild(md);
          this.hasTrailingGap = false;
        }
        break;
      case "tool": {
        const gapBeforeTool = !this.lastBandWasTool || this.lastBandToolHadBody;
        if (gapBeforeTool) {
          this.addSectionGap();
        }
        const block = ToolBlock.fromCompleted(
          step.name,
          step.args,
          step.result,
          step.durationMs
        );
        const compact = shouldCompactToolOutput(
          step.name,
          step.result.success,
          step.result.metadata
        );
        if (compact) {
          block.setDone(step.result, step.durationMs, { collapsed: true, compact: true });
        }
        this.chat.addChild(block);
        this.lastBandWasTool = true;
        this.lastBandToolHadBody = block.hasExpandedBody();
        this.hasTrailingGap = false;
        break;
      }
      default:
        break;
    }
  }

  private async applyResumeSession(sessionID: string): Promise<void> {
    try {
      const session = await SessionManager.load(sessionID);
      resetAllowAllBypass();
      this.syncAllowAllBypassUi();
      this.resetTurnUiState();
      this.clearChatView();
      this.applySessionToRenderer(session);
      this.showSessionRestored(session);
      this.hydrateChatFromSession(session);
      this.tui.requestRender();
    } catch (e) {
      this.addChatLine(clr.error(`Failed to load session: ${(e as Error).message}`));
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

    this.sessionPickerHandle = this.showSessionPickerOverlay(overlay);
    this.tui.requestRender();
  }

  private async runShellReview(
    question: string,
    shellResult: ShellRunResult
  ): Promise<void> {
    const userMessage = [
      "The user ran a shell command and wants help interpreting the output.",
      `Command: ${shellResult.command}`,
      `Directory: ${shellResult.cwd}`,
      `Exit code: ${shellResult.exitCode}`,
      "Output:",
      shellResult.output.slice(0, 12000),
      "",
      `Question: ${question}`,
    ].join("\n");

    this.isRunning = true;
    this.loop.setImages([]);
    this.addSectionGap();
    this.addChatLine(`${A.fg(36, this.userName)}`);
    this.addChatLine(`@ ${question}`);
    this.addSectionGap();

    this.streamingRaw = "";
    this.streamingText = null;

    const events: LoopEvents = {
      onTurnStart: () => {
        this.setBusyStatus("", "Reviewing shell output..");
      },
      onToken: (text) => {
        if (!this.streamingText) {
          this.chat.addChild(new Text(`${GUTTER}${A.fg(33, "impulse")}${A.reset}`, 0, 0));
          this.streamingText = new MarkdownTextBlock(GUTTER);
          this.chat.addChild(this.streamingText);
          this.hasTrailingGap = false;
        }
        this.streamingRaw += text;
        this.streamingText.setText(this.streamingRaw);
        this.requestBottomAnchorRefresh();
      },
      onThinking: (text) => {
        this.appendWorkerThinking(text);
        this.requestBottomAnchorRefresh();
      },
      onAdvisorStart: () => {},
      onAdvisorToken: () => {},
      onAdvisorEnd: () => {},
      onToolStart: () => {},
      onToolEnd: () => {},
      onCompacting: () => {},
      onCompacted: () => {},
      onTurnEnd: () => {
        this.spinStop();
        if (this.streamingRaw) this.addSectionGap();
        this.streamingRaw = "";
        this.streamingText = null;
        this.thinkingRaw = "";
        this.thinkingText = null;
        this.isRunning = false;
        this.addSectionGap();
        this.tui.requestRender();
        this.drainTurnQueue();
      },
      onHardCutoff: () => {},
      onError: (err) => {
        this.spinStop();
        this.addChatLine(`${clr.error("Error:")} ${err.message}`);
        this.isRunning = false;
        this.tui.requestRender();
        this.drainTurnQueue();
      },
    };

    try {
      await this.loop.run(userMessage, this.mode, events, {
        displayMessage: `@ ${question}`,
        segments: [{ kind: "text", value: userMessage }],
      });
    } catch {
      this.isRunning = false;
      this.drainTurnQueue();
    }
  }

}
