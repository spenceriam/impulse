/**
 * ImpulseRenderer ? full TUI using @mariozechner/pi-tui
 *
 * Layout (top to bottom):
 *   chatContainer     - conversation history (grows downward as turns add content)
 *   loaderLine        - spinner/status while agent works
 *   separator         - divider above input
 *   promptInput       - user prompt
 *   separator         - divider above context bar
 *   contextBar        - model, tokens, dir, branch, mode, stats
 *
 * The layout intentionally stays top-anchored. Recomputing top padding to pin
 * the prompt to the viewport bottom shifts all chat line indexes during
 * streaming/tool settlement and can force full-screen redraws.
 */

import {
  TUI,
  ProcessTerminal,
  Container,
  Text,
  Spacer,
  type Component,
  type OverlayHandle,
} from "@mariozechner/pi-tui";
import type { EditorTheme } from "@mariozechner/pi-tui";
import { z } from "zod";
import { spawn } from "child_process";
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
  renderSlashAutocompleteLines,
  type SlashCompleteCycle,
  type SlashCommandEntry,
} from "./slash-autocomplete.js";
import {
  buildTopLevelSlashCommandList,
  cycleDisplayedMode,
  resolveModeCommand,
} from "./slash-commands.js";
import { setAtAutocomplete } from "./at-autocomplete.js";
import { canonicalizeSlashAliasInput } from "./slash-aliases.js";
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
const InstructionsCommandActionSchema = z.enum([
  "view",
  "show",
  "replace",
  "set",
  "append",
  "import",
  "clear",
]);
import { overlayMinWidth } from "./layout.js";
import { overlayMaxHeightForContent, overlayViewportMaxHeight } from "./overlay-height.js";
import { PromptHistory } from "./prompt-history.js";
import { loadPromptHistory, savePromptHistory } from "../util/prompt-history-store.js";
import {
  isAllowAllBypass,
} from "../permission/index.js";
import {
  ALLOW_ALL_WARNING,
  configureApprovalPolicy,
  effectiveApprovalPolicy,
  setPersistedApprovalPolicy,
} from "../permission/policy.js";
import { ContextBarComponent, gitBranch } from "./components/context-bar.js";
import { clearActiveSessionMarker } from "../util/active-session-marker.js";
import {
  isCosmeticTodoRewrite,
  isSilentUnchangedTodoWrite,
  ToolBlock,
  shouldCompactToolOutput,
} from "./components/tool-block.js";
import { TaskBatchPermissionOverlay } from "./components/task-batch-permission-overlay.js";
import type { TaskBatchDecision } from "../permission/task-batch.js";
import { MarkdownTextBlock } from "./components/markdown-text.js";
import {
  planStreamingRotation,
  splitAtSafeBoundary,
  type StreamSplit,
} from "./stream-split.js";
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
import { ExecutionHandoffOverlay } from "./components/execution-handoff-overlay.js";
import { PreviewReviewOverlay } from "./components/preview-review-overlay.js";
import { SessionPickerOverlay } from "./components/session-picker-overlay.js";
import { ProfileOverlay } from "./components/profile-overlay.js";
import {
  SelectableListOverlay,
  type SelectableListRow,
} from "./components/selectable-list-overlay.js";
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
import type { LoopEvents } from "../agent/loop.js";
import { TuiRuntimeController } from "../runtime/tui-controller.js";
import { SILENT_TOOLS } from "../tools/silent-tools.js";
import {
  load as loadConfig,
  save as saveConfig,
  isModelConfigured,
  isExperimentalAdvisorEnabled,
  isExperimentalGoalEnabled,
  isExperimentalUndoEnabled,
  type Config,
  type PresentationDensity,
  type ReasoningLevel,
  type ThinkingDisplay,
} from "../util/config.js";
import {
  USER_INSTRUCTIONS_DISPLAY_PATH,
  loadEffectiveUserInstructions,
  writeUserInstructions,
} from "../util/user-instructions.js";
import {
  checkForUpdate,
  getCurrentVersion,
  impulseCommand,
  INTERNAL_AUTO_UPDATE_ENV,
  UPDATE_PARENT_PID_ENV,
} from "../util/update-check.js";
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
import { HeaderEvents, ModeEvents, QuestionEvents, ExecutionHandoffEvents, SubagentEvents, BranchEvents } from "../bus/events.js";
import { PermissionEvents, respond, type PermissionRequest } from "../permission/index.js";
import { SessionManager } from "../session/manager.js";
import {
  resumeSessionWithAuthority,
  type ResumeAuthorityResult,
} from "../session/resume-authority.js";
import { createNewSessionWithAuthority } from "../session/new-session-authority.js";
import { CompactManager } from "../session/compact.js";
import { estimateSessionContextTokens } from "../session/token-estimate.js";
import { CheckpointManager } from "../session/checkpoint.js";
import { formatImpulseUiStatus } from "../session/status-events.js";
import {
  createGoalState,
  type GoalState,
} from "../session/goal-state.js";
import {
  buildGoalContinuationMessage,
  isGoalLoopExecutable,
  judgeGoal,
  runGoalLoopActionIfExecutable,
} from "../agent/goal-loop.js";
import {
  getActivePlanRevision,
  listRevisionIds,
  readPlanTasksMarkdown,
} from "../plan/revisions.js";
import { getRevisionDir, toRelativePlanPath } from "../plan/paths.js";
import {
  writeGoalArtifact,
  deleteGoalArtifact,
  appendGoalProgress,
  hydrateGoalFromSession,
  type GoalHydrationSource,
} from "../goal/artifact.js";
import { invalidatePromptCache } from "../agent/prompts.js";
import { clearProjectStructureCache } from "../agent/project-structure.js";
import { getRepairTelemetrySummary } from "../harness/repair-telemetry.js";
import {
  collectSessionStats,
  formatSessionStatsBlock,
} from "../session/session-stats.js";
import { writeUpdateResumeHint } from "../util/update-resume-hint.js";
import { abortCurrentBashExecution, clearShellSessions } from "../tools/bash.js";
import { listInstalledSkills, type InstalledSkillMeta } from "../tools/install-skill-source.js";
import {
  createSkillActionOverlay,
  createSkillsListOverlay,
} from "./skills-presentation.js";
import { countRunningBgJobs, BgJobEvents } from "../tools/bg-process-registry.js";
import {
  cleanupExecutionParticipants,
  type ExecutionCleanupContext,
} from "../tools/execution-revocation.js";
import { removeSkill } from "../tools/skill-remove.js";
import { DefaultSkillScaffolding } from "../skills/default-skills.js";
import { rejectQuestion, resolveQuestion, type Question } from "../tools/question.js";
import {
  resolveExecutionHandoff,
  USER_HANDOFF_AUTHORITY,
  type ExecutionHandoffChoice,
} from "../tools/execution-handoff.js";
import { PreviewManager, type PreviewReview } from "../preview/manager.js";
import {
  PreviewApplyController,
  USER_PREVIEW_APPLY_AUTHORITY,
} from "../preview/apply-controller.js";
import {
  getCurrentMode,
  restoreAgentAuthorityAfterLifecycle,
  setCurrentMode,
} from "../tools/mode-state.js";
import { restoreAskExecutionAdmissionAfterFailure } from "../tools/execution-admission.js";
import {
  DEFAULT_MODE,
  normalizeMode,
  type Mode,
} from "../constants.js";
import {
  A,
  advisorStatusLine,
  clr,
  MODE_COLORS,
  modelStatusLine,
} from "./ansi-theme.js";
import { dispatchSlashCommand, type SlashDispatchHost } from "./slash-dispatch.js";
import { DEFAULT_MAX_TURN_QUEUE, TurnQueueManager } from "./turn-queue.js";
import { buildQueuePreviewText } from "./queue-preview.js";
import {
  agentAuthorityError,
  explicitUserModeTransitionNotice,
  modelModeTransitionCommittedNotice,
  modeTransitionFailureNotice,
} from "./mode-authority.js";
import { transitionModeAuthority } from "../tools/mode-transition.js";
import {
  isExecutionTurnAdmissionOpen,
  registerExecutionStart,
  type ExecutionStartRegistration,
} from "../tools/execution-admission.js";
import { copy as copyToClipboard } from "../util/clipboard.js";
import {
  clearTerminalForTuiStart,
  ensurePiTuiDebugRedrawDir,
} from "./terminal-clear.js";
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

export { buildSkillRows } from "./skills-presentation.js";

export type ResumeStartup = "picker" | { sessionId: string };

export interface ImpulseRendererOptions {
  resume?: ResumeStartup;
  /** "interrupted" when resume came from the active-session marker (#78). */
  resumeReason?: "interrupted";
  /** Prompt the allow-all disclaimer at startup; set via --aa / --allow-all / IMPULSE_ALLOW_ALL=1 */
  allowAllOnStartup?: boolean;
}

export class ImpulseRenderer {
  // pi-tui objects
  private terminal = new ProcessTerminal();
  private tui!: TUI;
  private readonly startupResume: ResumeStartup | null;
  private readonly startupResumeReason: "interrupted" | null;
  private startupResumeAttempted = false;
  private startupResumeResult: ResumeAuthorityResult<Session> | null = null;
  private startupResumeError: Error | null = null;
  private readonly allowAllOnStartup: boolean;
  private readonly defaultSkillScaffolding: DefaultSkillScaffolding;
  private readonly previewManager: PreviewManager;
  private readonly previewApplyController: PreviewApplyController;
  private skipGoalContinuation = false;
  /** Chat children below welcome header (fixed); cleared on /new and /resume */
  private welcomeChildCount = 0;


  // Layout components
  private chat!: Container;
  private spinnerText!: Text;
  private queuePreviewText!: Text;
  private static readonly MAX_TURN_QUEUE = DEFAULT_MAX_TURN_QUEUE;
  private static readonly MAX_MUTABLE_STREAM_LINES = 12;
  /** Past this rendered-line count, rotation may fall back to a last-safe-line cut. */
  private static readonly MAX_MUTABLE_STREAM_LINES_HARD = 24;
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
    this.requestRenderForPhase("spin_stop");
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

  private logRenderDebug(phase: string, before: number, rows: number, cols: number): void {
    if (process.env["IMPULSE_RENDER_DEBUG"] !== "1" || !this.tui) return;
    const after = this.tui.fullRedraws;
    if (after <= before) return;
    const timestamp = new Date().toISOString();
    const sessionID = SessionManager.getCurrentSessionID() ?? "no-session";
    fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
    fs.appendFileSync(
      debugLogPath,
      `[${timestamp}] [${sessionID}] render full-redraw phase=${phase} count=${after - before} rows=${rows}->${this.terminal.rows} cols=${cols}->${this.terminal.columns}\n`
    );
  }

  private requestRenderForPhase(phase: string): void {
    if (!this.tui) return;
    if (process.env["IMPULSE_RENDER_DEBUG"] !== "1") {
      this.tui.requestRender();
      return;
    }

    const before = this.tui.fullRedraws;
    const rows = this.terminal.rows;
    const cols = this.terminal.columns;
    this.tui.requestRender();
    setTimeout(() => this.logRenderDebug(phase, before, rows, cols), 25);
  }

  private findLatestVisibleTodoBlock(): ToolBlock | null {
    for (let i = this.chat.children.length - 1; i >= 0; i--) {
      const child = this.chat.children[i];
      if (child instanceof ToolBlock && child.isTodoTool()) {
        return child;
      }
    }
    return null;
  }

  private removeSilentTodoToolBlock(block: ToolBlock, id: string): void {
    const wasLatestTodo = this.latestTodoBlock === block;
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
    if (wasLatestTodo) {
      this.latestTodoBlock = this.findLatestVisibleTodoBlock();
    }
  }

  /** Check if the advisor workflow should be turned off (all tasks complete). */
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
      `The main agent suggests the advisor workflow is no longer needed.`,
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
      this.addChatLine(clr.dim("Advisor workflow disabled  --  all tasks complete"));
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
    this.requestRenderForPhase("status");

    if (!this.spinnerInterval) {
      this.spinnerInterval = setInterval(() => {
        this.renderBusyLine();
        this.requestRenderForPhase("status_tick");
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

    const overlay = new PermissionOverlay(request, this.presentationDensity);
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

    const overlay = new QuestionOverlay({
      context,
      questions,
      presentationDensity: this.presentationDensity,
    });
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

  private dismissExecutionHandoffOverlay(): void {
    this.executionHandoffOverlayHandle?.hide();
    this.executionHandoffOverlayHandle = null;
    this.tui?.setFocus(this.promptInput);
    this.tui?.requestRender();
  }

  private showExecutionHandoffOverlay(input: {
    id: string;
    request: string;
    description: string;
  }): void {
    if (!this.tui) return;
    this.dismissExecutionHandoffOverlay();
    const overlay = new ExecutionHandoffOverlay(input);
    overlay.onDecision = (choice) => {
      this.dismissExecutionHandoffOverlay();
      void this.handleExecutionHandoffDecision(input, choice);
    };
    this.executionHandoffOverlayHandle = this.showContentSizedOverlay(overlay, {
      maxHeight: overlayViewportMaxHeight(this.tui.terminal?.rows ?? this.terminal.rows ?? 24),
    });
    this.tui.requestRender();
  }

  private async handleExecutionHandoffDecision(
    input: { id: string; request: string; description: string },
    choice: ExecutionHandoffChoice
  ): Promise<void> {
    if (choice === "stay") {
      resolveExecutionHandoff(input.id, choice, USER_HANDOFF_AUTHORITY);
      this.addChatLine(clr.dim("Stayed in ASK · project remains read-only"));
      this.tui.requestRender();
      return;
    }

    if (choice === "agent") {
      const changed = await this.applyModeChange("AGENT", {
        prev: this.mode,
        source: "explicit-user-transition",
      });
      resolveExecutionHandoff(input.id, choice, USER_HANDOFF_AUTHORITY);
      if (!changed && this.mode !== "AGENT") {
        this.addChatLine(clr.warn("Could not enter AGENT; execution remains ASK."));
      }
      this.tui.requestRender();
      return;
    }

    await this.runSafePreviewRequest(input.request, input.description);
    resolveExecutionHandoff(input.id, choice, USER_HANDOFF_AUTHORITY);
  }

  private async runSafePreviewRequest(
    request: string,
    description: string
  ): Promise<boolean> {
    this.addChatLine(clr.dim("PREVIEW · probing bubblewrap · network off"));
    this.syncApprovalPolicyUi("PREVIEW");
    this.tui.requestRender();
    let result;
    try {
      result = await this.previewManager.preview({ prompt: request, description });
    } catch (error) {
      this.addChatLine(clr.warn(
        `Safe preview failed: ${error instanceof Error ? error.message : String(error)}`
      ));
      this.addChatLine(clr.dim("Stayed in ASK · no host fallback was used"));
      return false;
    } finally {
      this.syncApprovalPolicyUi("HOST");
    }

    if (result.status !== "ready") {
      this.addChatLine(clr.warn(result.notice));
      if (result.status === "unavailable" && result.remediation) {
        this.addChatLine(clr.dim(result.remediation));
      }
      this.addChatLine(clr.dim("Stayed in ASK · use /mode AGENT only for explicit host execution"));
      this.tui.requestRender();
      return false;
    }

    this.addChatLine(clr.dim("PREVIEW · bubblewrap · network off · process cleanup confirmed"));
    this.addChatLine(clr.dim(
      result.changedFiles.length > 0
        ? `Changed: ${result.changedFiles.join(", ")}`
        : "Changed: no files"
    ));
    if (result.diffStat) this.addChatLine(clr.dim(result.diffStat));
    for (const line of result.agentSummary.slice(0, 3)) this.addChatLine(clr.dim(line));
    this.showPreviewReviewOverlay(result);
    this.tui.requestRender();
    return true;
  }

  private dismissPreviewReviewOverlay(): void {
    this.previewReviewOverlayHandle?.hide();
    this.previewReviewOverlayHandle = null;
    this.tui?.setFocus(this.promptInput);
    this.tui?.requestRender();
  }

  private showPreviewReviewOverlay(review: PreviewReview): void {
    const overlay = new PreviewReviewOverlay(review);
    overlay.onDecision = (decision) => {
      this.dismissPreviewReviewOverlay();
      void this.handlePreviewReviewDecision(review, decision);
    };
    this.previewReviewOverlayHandle = this.showContentSizedOverlay(overlay, {
      maxHeight: overlayViewportMaxHeight(this.tui.terminal?.rows ?? this.terminal.rows ?? 24),
    });
    this.tui.requestRender();
  }

  private async handlePreviewReviewDecision(
    review: PreviewReview,
    decision: "apply" | "discard" | "keep"
  ): Promise<void> {
    if (decision === "discard") {
      const result = await this.previewManager.discard(review.id);
      this.addChatLine(result.ok ? clr.dim(result.notice) : clr.warn(result.notice));
      this.tui.requestRender();
      return;
    }
    if (decision === "keep") {
      const kept = this.previewManager.keep(review.id);
      this.addChatLine(clr.dim(`Preview kept: ${kept.path}`));
      this.addChatLine(clr.dim(`Cleanup: ${kept.cleanupCommand}`));
      this.tui.requestRender();
      return;
    }

    const result = await this.previewApplyController.apply(
      review.id,
      USER_PREVIEW_APPLY_AUTHORITY
    );
    if (result.ok) {
      this.addChatLine(clr.dim(`Applied reviewed preview: ${result.changedFiles.join(", ") || "no files"}`));
    } else {
      this.addChatLine(clr.warn(result.notice));
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

  private async handleCtrlC(): Promise<void> {
    if (this.modelSetup) {
      this.cancelModelSetup();
      return;
    }

    if (await this.abortActiveShell()) {
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
    void abortCurrentBashExecution();
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
    this.requestLayoutRefresh();
    this.tui.requestRender();
  }

  private drainTurnQueue(): void {
    const next = this.turnQueue.dequeueForExecution({
      isRunning: this.isRunning,
      admissionOpen: isExecutionTurnAdmissionOpen(this.mode === "AGENT"),
    });
    if (!next) {
      this.updateQueuePreview();
      return;
    }
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

  private async persistGoalState(options?: {
    signal?: AbortSignal;
    requireAgentAuthority?: boolean;
  }): Promise<void> {
    const canPersist = () =>
      options?.signal?.aborted !== true &&
      (!options?.requireAgentAuthority ||
        (this.mode === "AGENT" && getCurrentMode() === "AGENT"));
    if (!canPersist()) return;

    const session = SessionManager.getCurrentSession();
    if (!session) return;
    // Write to .impulse/goals/ artifact (primary) and keep metadata key for
    // backward compat with older sessions that only have the metadata path.
    if (this.goalState) {
      try {
        if (!canPersist()) return;
        await writeGoalArtifact(session.id, this.goalState);
      } catch {
        // Non-fatal: fall back to metadata-only path
      }
    } else {
      if (!canPersist()) return;
      try {
        deleteGoalArtifact(session.id);
      } catch {
        // Non-fatal
      }
    }
    if (!canPersist()) return;
    const metadata = { ...(session.metadata ?? {}), goal: this.goalState };
    await SessionManager.update({ metadata });
    if (!canPersist()) return;
    invalidatePromptCache();
  }

  private loadGoalFromSession(
    session: Session,
    source: GoalHydrationSource = "session-hydration"
  ): void {
    const hydration = hydrateGoalFromSession({
      sessionId: session.id,
      metadataGoal: session.metadata?.["goal"],
      mode: this.mode,
      source,
    });
    this.goalState = hydration.state;
    void hydration.migration.catch(() => { /* non-fatal */ });
  }

  private goalLoopActive(): boolean {
    return getCurrentMode() === "AGENT" &&
      isGoalLoopExecutable(
        this.mode,
        this.experimentalGoalEnabled,
        this.goalState
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
    if (!this.goalLoopActive()) {
      this.drainTurnQueue();
      return;
    }
    const judgeModel = cfg.subagentModel?.trim() || cfg.defaultModel?.trim();

    let planTasksMarkdown: string | undefined;
    let planTasksPath: string | undefined;
    if (activeGoal.planRevisionId) {
      const sessionId = SessionManager.getCurrentSessionID() ?? "";
      const tasks = readPlanTasksMarkdown(sessionId, activeGoal.planRevisionId);
      if (tasks) {
        planTasksMarkdown = tasks;
        planTasksPath = toRelativePlanPath(getRevisionDir(sessionId, activeGoal.planRevisionId));
      } else {
        const notice = await runGoalLoopActionIfExecutable({
          mode: this.mode,
          experimentalGoalEnabled: this.experimentalGoalEnabled,
          state: activeGoal,
          action: async (signal) => {
            if (signal.aborted) return;
            await this.emitStatusEvent(
              `Plan revision ${activeGoal.planRevisionId} not found — judging against goal text only.`
            );
          },
        });
        if (!notice.executed || !this.goalLoopActive()) {
          return;
        }
      }
    }

    const judgeAction = await runGoalLoopActionIfExecutable({
      mode: this.mode,
      experimentalGoalEnabled: this.experimentalGoalEnabled,
      state: activeGoal,
      action: (signal) => judgeGoal(
        activeGoal,
        this.lastAssistantTurnText,
        judgeModel,
        planTasksMarkdown ? { planTasksMarkdown, signal } : { signal }
      ),
    });
    if (!judgeAction.executed || !judgeAction.value || !this.goalLoopActive()) {
      return;
    }
    const result = judgeAction.value;

    const sessionId = SessionManager.getCurrentSessionID() ?? "";
    const judgedTurn = activeGoal.turnsUsed + 1;
    const logJudgeProgress = (verdict: string, reason: string) =>
      runGoalLoopActionIfExecutable({
        mode: this.mode,
        experimentalGoalEnabled: this.experimentalGoalEnabled,
        state: activeGoal,
        action: async (signal) => {
          if (signal.aborted) return;
          appendGoalProgress(sessionId, {
            turn: judgedTurn,
            verdict,
            reason,
            timestamp: new Date().toISOString(),
          });
        },
      });
    const persistIfExecutable = () => runGoalLoopActionIfExecutable({
      mode: this.mode,
      experimentalGoalEnabled: this.experimentalGoalEnabled,
      state: activeGoal,
      action: (signal) => this.persistGoalState({
        signal,
        requireAgentAuthority: true,
      }),
    });
    const emitStatusIfExecutable = (text: string) =>
      runGoalLoopActionIfExecutable({
        mode: this.mode,
        experimentalGoalEnabled: this.experimentalGoalEnabled,
        state: activeGoal,
        action: async (signal) => {
          if (signal.aborted) return;
          await this.emitStatusEvent(text);
        },
      });

    if (result.verdict === "done") {
      const logged = await logJudgeProgress("done", result.reason);
      if (!logged.executed || !this.goalLoopActive()) {
        return;
      }
      this.goalState = {
        ...activeGoal,
        status: "done",
        lastJudgeReason: result.reason,
      };
      const persisted = await persistIfExecutable();
      if (!persisted.executed) {
        return;
      }
      const status = await emitStatusIfExecutable(`Goal achieved: ${result.reason}`);
      if (!status.executed) return;
      this.drainTurnQueue();
      return;
    }

    if (result.verdict === "judge_unavailable") {
      const logged = await logJudgeProgress("judge_unavailable", result.reason);
      if (!logged.executed || !this.goalLoopActive()) {
        return;
      }
      this.goalState = {
        ...activeGoal,
        status: "paused_judge_unavailable",
        lastJudgeReason: result.reason,
      };
      const persisted = await persistIfExecutable();
      if (!persisted.executed) {
        return;
      }
      this.syncGoalContextBar();
      const status = await emitStatusIfExecutable(
        "Goal paused — judge model unavailable. Run /goal resume after restoring it."
      );
      if (!status.executed) return;
      this.drainTurnQueue();
      return;
    }

    const nextTurns = activeGoal.turnsUsed + 1;
    const logged = await logJudgeProgress("continue", result.reason);
    if (!logged.executed || !this.goalLoopActive()) {
      return;
    }
    const updatedGoal: GoalState = {
      ...activeGoal,
      turnsUsed: nextTurns,
      lastJudgeReason: result.reason,
    };
    this.goalState = updatedGoal;

    if (nextTurns >= activeGoal.maxTurns) {
      this.goalState = { ...updatedGoal, status: "paused" };
      const persisted = await persistIfExecutable();
      if (!persisted.executed) {
        return;
      }
      const status = await emitStatusIfExecutable(
        `Goal paused — ${nextTurns}/${activeGoal.maxTurns} turns. /goal resume`
      );
      if (!status.executed) return;
      this.drainTurnQueue();
      return;
    }

    const persisted = await persistIfExecutable();
    if (!persisted.executed || !this.goalLoopActive()) {
      return;
    }
    const continuation = buildGoalContinuationMessage(
      updatedGoal,
      planTasksPath ? { planTasksPath } : undefined
    );
    await runGoalLoopActionIfExecutable({
      mode: this.mode,
      experimentalGoalEnabled: this.experimentalGoalEnabled,
      state: updatedGoal,
      action: (signal) => this.runTurn({
        apiText: continuation,
        displayMessage: continuation,
        orderedImages: [],
        segments: [],
      }, { autonomousGoalSignal: signal }),
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

  private deleteQueueEdit(): void {
    const { editIndex } = this.turnQueue.editState;
    this.turnQueue.deleteAt(editIndex);
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

  private async abortActiveShell(): Promise<boolean> {
    if (this.shellCommandRunning) {
      const stopped = await abortUserShell();
      if (!stopped) {
        this.addChatLine(clr.warn("Shell cancellation failed -- process still running"));
        this.tui.requestRender();
        return true;
      }
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
    void this.abortActiveShell();
    return true;
  }

  private async runBangCommand(command: string): Promise<void> {
    if (this.showAgentAuthorityRequirement("run shell commands")) return;
    this.addSectionGap();
    const block = new ShellCommandBlock(command);
    this.activeShellBlock = block;
    this.chat.addChild(block);
    this.hasTrailingGap = false;
    this.shellCommandRunning = true;
    this.shellTakeoverActive = false;
    this.requestLayoutRefresh();

    const interactive = /\bsudo\b/.test(command) || command.includes("ssh");
    if (interactive) {
      block.setInteractiveHint(true);
    }

    let result: ShellRunResult;
    try {
      result = await runUserShellCommand({
        command,
        cols: this.terminalCols(),
        rows: Math.max(8, (this.tui.terminal?.rows ?? 24) - 12),
        onData: (chunk) => {
          block.appendOutput(chunk);
          this.requestLayoutRefresh();
        },
        forceInteractive: interactive,
      });
    } catch (error) {
      this.shellCommandRunning = false;
      this.shellTakeoverActive = false;
      block.setInteractiveHint(false);
      block.setTakeoverActive(false);
      block.setCancelled();
      this.activeShellBlock = null;
      this.addChatLine(clr.warn(error instanceof Error ? error.message : String(error)));
      this.requestLayoutRefresh();
      return;
    }

    this.shellCommandRunning = false;
    this.shellTakeoverActive = false;
    block.setInteractiveHint(false);
    block.setTakeoverActive(false);
    block.setDone(result.exitCode, result.durationMs);
    this.lastShellOutput = result;
    this.activeShellBlock = null;
    this.requestLayoutRefresh();
  }

  // Streaming state: current assistant text block (updated in-place)
  private streamingText: MarkdownTextBlock | null = null;
  private streamingRaw = "";
  /** Separator appended before the next frozen segment in currentTurnAssistantText; a
   *  line-cut rotation sets this to "\n" for one segment so /copy stays byte-faithful. */
  private nextTurnSegmentSeparator = "\n\n";
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
  /** Todo block shown before the current in-flight todo_write (for cosmetic rewrites). */
  private todoBlockBeforeRewrite: ToolBlock | null = null;
  private taskCodenames = new Map<string, string>();
  private taskBatchOverlayHandle: OverlayHandle | null = null;
  private ctrlCPending: "cancel" | "exit" | null = null;
  private ctrlCPendingAt = 0;
  private static readonly CTRL_C_WINDOW_MS = 2000;
  private permissionQueue: PermissionRequest[] = [];
  private activePermission: PermissionRequest | null = null;
  private permissionOverlayHandle: OverlayHandle | null = null;
  private loopCheckinOverlayHandle: OverlayHandle | null = null;
  private questionOverlayHandle: OverlayHandle | null = null;
  private executionHandoffOverlayHandle: OverlayHandle | null = null;
  private previewReviewOverlayHandle: OverlayHandle | null = null;
  private sessionPickerHandle: OverlayHandle | null = null;
  private modelPickerHandle: OverlayHandle | null = null;
  private modelSetupOverlayHandle: OverlayHandle | null = null;
  private profileOverlayHandle: OverlayHandle | null = null;
  private busUnsubscribe: (() => void) | null = null;
  private branchWatcher: GitBranchWatcher | null = null;
  /** Last branch name actually announced in chat — dedupes redundant BranchEvents.Changed
   *  fires from the two independent detection sources (command-driven + fs.watch), which
   *  each debounce/cache on their own but can still both legitimately fire for one switch. */
  private lastAnnouncedGitBranch: string | undefined;
  private liveTurnStartedAt = 0;
  private liveGeneratedChars = 0;
  private lastLiveMetricsAt = 0;

  // Agent + state
  private loop = new TuiRuntimeController({ cwd: process.cwd() });
  private mode: Mode = "ASK";
  private modeTransitionPending = false;
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
  private presentationDensity: PresentationDensity = "compact";
  private reasoningCapability: ReasoningCapability = { supported: true, style: "binary", levels: ["off", "medium"] };
  private isRunning = false;
  private allowAllDisclaimerHandle: OverlayHandle | null = null;
  private modelSetup: ModelSetupState | null = null;
  private planApprovalOverlayHandle: OverlayHandle | null = null;
  private planApprovalInputCleanup: (() => void) | null = null;
  private skillsOverlayHandle: OverlayHandle | null = null;
  private instructionsOverlayHandle: OverlayHandle | null = null;
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

  constructor(options?: ImpulseRendererOptions) {
    this.startupResume = options?.resume ?? null;
    this.startupResumeReason = options?.resumeReason ?? null;
    this.allowAllOnStartup = options?.allowAllOnStartup ?? false;
    this.defaultSkillScaffolding = new DefaultSkillScaffolding(process.cwd());
    this.previewManager = new PreviewManager({ activeWorkspace: process.cwd() });
    this.previewApplyController = new PreviewApplyController({
      checkApply: (id) => this.previewManager.checkApply(id),
      apply: (id) => this.previewManager.apply(id),
      transition: (mode) => this.applyModeChange(mode, {
        prev: this.mode,
        source: "explicit-user-transition",
      }),
    });
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
    configureApprovalPolicy({ persisted: config.approvalPolicy });
    // Persisted config/session modes are historical metadata. Runtime authority
    // always starts in ASK until the user explicitly grants AGENT.
    this.mode = DEFAULT_MODE;
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
      defaultMode: DEFAULT_MODE,
      initialContextWindow: this.contextWindow,
    });

    if (!SessionManager.getCurrentSession()) {
      // When startup resume targets a known session, load it directly instead
      // of eagerly creating a blank session first (avoids orphan empty
      // sessions; #78). Falls back to a fresh session if the load fails.
      let resumedAtBoot = false;
      if (this.startupResume && this.startupResume !== "picker") {
        this.startupResumeAttempted = true;
        try {
          const result = await this.resolveSessionResume(this.startupResume.sessionId);
          this.startupResumeResult = result;
          resumedAtBoot = result.ok;
          if (result.ok) {
            this.mode = result.mode;
            setCurrentMode(result.mode);
          }
        } catch (error) {
          this.startupResumeError = error instanceof Error ? error : new Error(String(error));
          resumedAtBoot = false;
        }
      }
      if (!resumedAtBoot) {
        await SessionManager.createNew();
        const sess = SessionManager.getCurrentSession();
        if (sess && config.defaultModel?.trim()) {
          await SessionManager.update({ model: config.defaultModel });
        }
      }
    }

    config = await loadConfig();
    this.syncAdvisorFromConfig(config);

    this.contextWindow = SessionManager.getCurrentSession()?.context_window ?? this.contextWindow;
    this.contextTokens = this.estimateCurrentSessionTokens();

    const historyEntries = await loadPromptHistory();
    this.promptHistory.loadEntries(historyEntries);

    // Debug logging
    debugLog(`Session started`);
    debugLog(`thinking: ${config.thinking}, reasoningLevel: ${config.reasoningLevel}`);
    debugLog(`provider: ${config.defaultProvider}, model: ${config.defaultModel}`);

    // Startup only discovers skills already on disk. Bundled defaults require
    // an explicit user transition into AGENT before they may be scaffolded.
    await this.defaultSkillScaffolding.initialize(this.mode, "startup");

    // ?? Build TUI layout ??????????????????????????????????????????????????
    this.tui = new TUI(this.terminal);
    this.tui.setClearOnShrink(false);

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

      if (event.type === ExecutionHandoffEvents.Asked.name) {
        this.showExecutionHandoffOverlay(event.properties as {
          id: string;
          request: string;
          description: string;
        });
        return;
      }

      if (event.type === HeaderEvents.Updated.name) {
        const { title } = event.properties as { title: string };
        void this.onHeaderTitleUpdated(title);
        return;
      }

      if (event.type === ModeEvents.Changed.name) {
        const { mode, reason } = event.properties as { mode: string; reason?: string };
        const next = normalizeMode(mode) as Mode;
        this.applyCommittedModelModeChange(next, reason);
        return;
      }

      if (event.type === ModeEvents.TransitionFailed.name) {
        const result = event.properties as {
          mode: "AGENT";
          requestedMode: "ASK";
          failedParticipantIds: string[];
          stoppedJobs: number;
          stoppedShells: number;
        };
        this.applyModelModeTransitionFailure(result);
        return;
      }

      if (event.type === BgJobEvents.Changed.name) {
        // Event-driven redraw for the ba segment — covers a job finishing
        // while no turn is active, without a dedicated polling interval.
        this.syncBgContextBar();
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
          this.requestRenderForPhase("subagent_progress");
        }
      }

      if (event.type === BranchEvents.Changed.name) {
        // Command-driven detection and the fs.watch source each debounce/cache
        // independently, so one real switch can legitimately publish this event
        // more than once. Re-read the branch fresh and only act if it actually
        // differs from what was last announced — the real fix for the redundant
        // "Git branch changed" repeats, not a bug in either upstream source.
        const currentBranch = gitBranch(process.cwd());
        if (currentBranch === this.lastAnnouncedGitBranch) {
          return;
        }
        this.lastAnnouncedGitBranch = currentBranch;
        this.contextBar.invalidate();
        // Session state is intentionally untouched on branch changes (#78) —
        // surface a small note so users know why version/behavior may differ.
        this.addChatLine(clr.dim("Git branch changed — session unaffected"));
        this.tui.requestRender();
        return;
      }
    });

    // 1. Chat history ? grows top-down as turns are added.
    // Do not bottom-anchor with top padding: changing that padding during
    // streaming/tool settlement shifts line indexes and can force full redraws.
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
      this.promptHistory.saveDraft(this.promptInput.getText());
      const prev = this.promptHistory.previous();
      if (prev !== null) this.promptInput.setText(prev);
    };
    this.promptInput.onArrowDown = () => {
      if (this.modelSetup) return;
      const draft = this.promptHistory.takeDraft();
      if (draft !== null) this.promptInput.setText(draft);
      else this.promptInput.clear();
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
      void this.cycleMode(1);
    };
    this.promptInput.onTabBackward = () => {
      if (this.modelSetup) return;
      if (isSlashCommandInput(this.promptInput.getText())) return;
      void this.cycleReasoning();
    };
    this.promptInput.onAbort = () => {
      void this.handleCtrlC();
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

    // 6. Context bar
    this.contextBar = new ContextBarComponent({
      workerModel: config.defaultModel,
      impulseVersion: (packageJson as { version: string }).version,
      contextTokens: this.contextTokens,
      contextWindow: this.contextWindow,
      mode: this.mode,
      reasoningLevel: this.reasoningDisplayLabel(),
      ...(this.advisorModel ? { advisorModel: this.advisorModel } : {}),
      showAdvisorInBar: this.experimentalAdvisorEnabled && (config.advisorMode ?? false),
      bottomBarVisual: config.bottomBarVisual ?? "full",
      presentationDensity: config.presentationDensity ?? "compact",
      executionBoundary: "HOST",
      approvalPolicy: effectiveApprovalPolicy() === "allow-all" ? "ALLOW-ALL" : "PROMPT",
    });
    this.syncVisionFromConfig(config);
    this.syncSpeedoUi();
    this.tui.addChild(this.contextBar);

    // Start git branch filesystem watcher to catch external branch switches
    this.branchWatcher = new GitBranchWatcher(process.cwd());
    this.branchWatcher.start();
    this.lastAnnouncedGitBranch = gitBranch(process.cwd());

    // ?? Start TUI (takes over terminal raw mode) ??????????????????????????
    this.syncModeColor(); // set initial arrow color
    this.tui.setFocus(this.promptInput);
    this.syncApprovalPolicyUi();

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
        this.requestLayoutRefresh();
        return { consume: true };
      }
      return undefined;
    });

    ensurePiTuiDebugRedrawDir();
    clearTerminalForTuiStart(this.terminal);
    this.tui.start();
    if (this.allowAllOnStartup && config.approvalPolicy !== "allow-all") {
      const agreed = await this.showAllowAllDisclaimer();
      if (agreed) {
        configureApprovalPolicy({
          persisted: config.approvalPolicy,
          launchOverride: "allow-all",
        });
        this.syncApprovalPolicyUi();
        this.addChatLine(clr.warn("ALLOW-ALL for this launch · HOST"));
      } else {
        this.addChatLine(clr.dim("Allow-all not enabled."));
      }
      this.tui.requestRender();
    } else if (effectiveApprovalPolicy() === "allow-all") {
      this.addChatLine(clr.warn("ALLOW-ALL persisted · HOST"));
      this.addChatLine(clr.dim(ALLOW_ALL_WARNING));
      this.tui.requestRender();
    }
    // Discover reasoning capabilities in background (non-blocking)
    void this.refreshReasoningCapability();
    void this.refreshActiveContextWindow(config, { discover: true });

    if (this.startupResume === "picker") {
      await this.cmdResume("");
    } else if (this.startupResume) {
      let resumed = false;
      if (this.startupResumeAttempted) {
        const result = this.startupResumeResult;
        if (result?.ok) {
          this.applyResolvedResume(result);
          resumed = true;
        } else if (result?.notice) {
          this.addChatLine(clr.warn(result.notice));
          this.syncBgContextBar();
          this.tui.requestRender();
        } else if (this.startupResumeError) {
          this.addChatLine(clr.error(`Failed to load session: ${this.startupResumeError.message}`));
          this.tui.requestRender();
        }
      } else {
        resumed = await this.applyResumeSession(this.startupResume.sessionId);
      }
      if (resumed && this.startupResumeReason === "interrupted") {
        const sess = SessionManager.getCurrentSession();
        const title =
          sess?.headerTitle?.trim() || sess?.name?.trim() || "previous session";
        this.addChatLine(
          clr.dim(`Previous session interrupted — resumed '${title}'`)
        );
        this.tui.requestRender();
      }
    }
  }

  // ?? Mode cycling ?????????????????????????????????????????????????????????

  private applyCommittedModelModeChange(next: Mode, reason?: string): void {
    const prev = this.mode;
    // Model events are committed de-escalations, never elevation authority.
    if (prev === "ASK" && next === "AGENT") return;
    if (prev === next) return;

    if (next === "ASK" && this.shellCommandRunning) this.clearRevokedUserShellUi();
    this.mode = next;
    setCurrentMode(next);
    this.syncContextBar({ mode: next });
    this.syncModeColor();
    this.syncBgContextBar();
    this.addChatLine(clr.dim(modelModeTransitionCommittedNotice(prev, next, reason)));
    if (SessionManager.getCurrentSession()) {
      void SessionManager.update({ mode: next }).catch((error) => {
        debugLog(`Failed to persist model mode change: ${String(error)}`);
      });
    }
    this.tui.requestRender();
    this.drainTurnQueue();
  }

  private applyModelModeTransitionFailure(result: {
    mode: "AGENT";
    requestedMode: "ASK";
    failedParticipantIds: string[];
    stoppedJobs: number;
    stoppedShells: number;
  }): void {
    this.mode = "AGENT";
    setCurrentMode("AGENT");
    this.syncContextBar({ mode: "AGENT" });
    this.syncModeColor();
    this.syncBgContextBar();
    this.addChatLine(clr.warn(modeTransitionFailureNotice(
      result.stoppedJobs,
      result.failedParticipantIds,
      result.stoppedShells
    )));
    this.tui.requestRender();
    this.drainTurnQueue();
  }

  /**
   * Mode is ambient state. Explicit user transitions also write a compact authority
   * notice so elevation stays visible when the context bar is disabled.
   */
  private async applyModeChange(
    next: Mode,
    options?: { prev?: Mode; source?: "model" | "explicit-user-transition" }
  ): Promise<boolean> {
    const prev = options?.prev ?? this.mode;
    if (prev === next) return false;
    if (this.modeTransitionPending) return false;
    this.modeTransitionPending = true;

    try {
      const transition = await transitionModeAuthority(prev, next, {
        source: options?.source === "model" ? "model" : "external",
      });
      if (!transition.changed) {
        setCurrentMode(prev);
        this.syncContextBar({ mode: prev });
        this.addChatLine(
          clr.warn(
            modeTransitionFailureNotice(
              transition.stoppedJobs,
              transition.failedJobIds
            )
          )
        );
        this.syncBgContextBar();
        return false;
      }

      if (transition.mode === "ASK" && ((transition.stoppedShells ?? 0) > 0 || this.shellCommandRunning)) {
        this.clearRevokedUserShellUi();
      }

      this.mode = transition.mode;
      setCurrentMode(transition.mode);
      this.syncContextBar({ mode: transition.mode });
      this.syncModeColor();
      this.syncBgContextBar();

      if (options?.source === "explicit-user-transition") {
        const notice = explicitUserModeTransitionNotice(
          prev,
          transition.mode,
          transition.stoppedJobs,
          transition.stoppedShells ?? 0
        );
        if (notice) {
          this.addChatLine(transition.mode === "AGENT" ? clr.warn(notice) : clr.dim(notice));
        }
      }

      if (SessionManager.getCurrentSession()) {
        void SessionManager.update({ mode: transition.mode }).catch((error) => {
          debugLog(`Failed to persist explicit mode change: ${String(error)}`);
        });
      }

      if (options?.source === "explicit-user-transition") {
        void this.defaultSkillScaffolding
          .initialize(transition.mode, "explicit-user-transition")
          .then(() => undefined)
          .catch((error) => {
            debugLog(`Default skill scaffolding failed: ${String(error)}`);
          });

        if (transition.mode === "AGENT") {
          const session = SessionManager.getCurrentSession();
          if (session) this.loadGoalFromSession(session, "explicit-user-transition");
        }
      }
      return true;
    } finally {
      this.modeTransitionPending = false;
    }
  }

  private async cycleMode(dir: 1 | -1): Promise<void> {
    if (this.isRunning) return;
    const prev = this.mode;
    const next = cycleDisplayedMode(this.mode, dir);
    const changed = await this.applyModeChange(next, { prev, source: "explicit-user-transition" });
    if (changed) invalidatePromptCache();
    this.tui.requestRender();
  }

  private syncModeColor(): void {
    // Mode color is shown on the context bar; prompt chevron stays dim (see PromptInput).
    this.promptInput.setModeColor(MODE_COLORS[this.mode] ?? 34);
  }

  private showAgentAuthorityRequirement(action: string): boolean {
    const error = agentAuthorityError(this.mode, action);
    if (!error) return false;
    this.addChatLine(clr.warn(error));
    this.tui.requestRender();
    return true;
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
        this.deleteQueueEdit();
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
      this.recordSubmittedPrompt(input);
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
      const expandedSlash = canonicalizeSlashAliasInput(payload.apiText);
      const canonicalSlash = /^\/instructions(?:\s|$)/i.test(expandedSlash.trimStart())
        ? expandedSlash.trimStart()
        : expandedSlash.trim();
      this.recordSubmittedPrompt(canonicalSlash);
      await this.handleSlash(canonicalSlash);
      this.tui.requestRender();
      return;
    }

    const cfg = await loadConfig();
    if (!isModelConfigured(cfg)) {
      // Save the prompt to history even when model isn't configured
      // so the user can retrieve it with the up arrow after configuring the model
      const transcript = userTranscriptText(payload);
      this.recordSubmittedPrompt(transcript);

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

  private recordSubmittedPrompt(text: string): void {
    const t = text.trim();
    if (!t) return;
    this.promptHistory.push(t);
    void savePromptHistory(this.promptHistory.toJSON()).catch(() => {});
  }

  private async runTurn(
    payload: PromptSubmitPayload,
    options?: { autonomousGoalSignal?: AbortSignal }
  ): Promise<void> {
    if (!this.isNonemptySubmitPayload(payload)) {
      this.drainTurnQueue();
      return;
    }
    const admission = registerExecutionStart(
      "renderer-turn",
      () => this.loop.abort(),
      { mutating: this.mode === "AGENT" }
    );
    if (!admission.accepted) {
      if (options?.autonomousGoalSignal === undefined) this.enqueueTurn(payload);
      return;
    }
    try {
      await this.runAdmittedTurn(payload, options, admission);
    } finally {
      admission.complete();
    }
  }

  private async runAdmittedTurn(
    payload: PromptSubmitPayload,
    options: { autonomousGoalSignal?: AbortSignal } | undefined,
    admission: ExecutionStartRegistration
  ): Promise<void> {
    const autonomousGoalCancelled = () =>
      admission.signal.aborted ||
      options?.autonomousGoalSignal?.aborted === true ||
      (options?.autonomousGoalSignal !== undefined && !this.goalLoopActive());
    if (autonomousGoalCancelled()) return;
    const userMessage = payload.apiText;
    const displayMessage = payload.displayMessage;
    const transcript = userTranscriptText(payload);
    // Mid-turn config validation: advisor workflow ON but config missing?
    const config = await loadConfig();
    if (autonomousGoalCancelled()) return;
    if (config.advisorMode && !isExperimentalAdvisorEnabled(config)) {
      this.addChatLine(
        `${clr.warn("!")} Advisor requires experimental flag. Run ${clr.tool("/experimental")} to enable.`
      );
      this.tui.requestRender();
      return;
    }
    if (config.advisorMode && !config.advisorModel) {
      this.addChatLine(`${clr.warn("!")} Advisor workflow is ON but no advisor model is configured.`);
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
      void SessionManager.update({ mode: this.mode }).catch((error) => {
        debugLog(`Failed to persist turn mode: ${String(error)}`);
      });
    }

    this.promptInput.clear();
    this.recordSubmittedPrompt(transcript);

    this.isRunning = true;
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

    const cfgForVision = config;
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
        this.nextTurnSegmentSeparator = "\n\n";
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
      },
      onToken: (text) => {
        if (!this.streamBusyPhraseSet) {
          this.setBusyStatus("Responding ...", BUSY_PROCESSING);
          this.streamBusyPhraseSet = true;
        }
        this.closeThinking();
        const nextStreamingRaw = this.prepareStreamingToken(text);
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
        this.streamingRaw = nextStreamingRaw;
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
          this.requestRenderForPhase("subagent_status");
        }
      },
      onToolStart: (id, name, args) => {
        // Silent tools still finalize any open stream so continuation text is a new block.
        if (SILENT_TOOLS.has(name)) {
          this.finalizeStreamingAtSafeBoundary(true);
          return;
        }

        this.closeThinking();
        this.finalizeStreamingAtSafeBoundary(false);
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
          {
            presentationDensity: this.presentationDensity,
            ...(subagentCodename !== undefined ? { subagentCodename } : {}),
          }
        );
        this.toolBlocks.set(id, block);
        this.chat.addChild(block);
        this.hasTrailingGap = false;
        this.lastBandWasTool = true;
        this.lastBandToolHadBody = false;
        this.lastExpandableTool = block;
        if (name === "todo_write") {
          this.todoBlockBeforeRewrite = this.latestTodoBlock;
        }
        if (name === "todo_write" || name === "todo_read") {
          this.markLatestTodoBlock(block);
        }

        const toolPhrase =
          name === "vision_translate" ? BUSY_PROCESSING : BUSY_WORKING;
        this.setBusyStatus(this.toolBusyStatus(name), toolPhrase);
        this.updateLiveMetrics(0, true);
        this.requestRenderForPhase("tool_start");
      },
      onToolEnd: (id, _name, result, durationMs) => {
        if (SILENT_TOOLS.has(_name)) {
          return;
        }

        // Update background job bar when a bash_bg job starts
        if (result.metadata?.["type"] === "bash_bg") {
          this.syncBgContextBar();
        }

        this.thinkingElapsedMs = 0;

        this.taskCodenames.delete(id);

        const block = this.toolBlocks.get(id);
        if (block) {
          if (isSilentUnchangedTodoWrite(_name, result)) {
            this.removeSilentTodoToolBlock(block, id);
            if (!this.isRunning) {
              this.tui.requestRender();
              return;
            }
            this.setBusyStatus("Waiting for model ...", BUSY_PROCESSING);
            this.updateLiveMetrics(result.output.length, true);
            this.requestRenderForPhase("tool_end_todo_noop");
            return;
          }

          if (isCosmeticTodoRewrite(_name, result)) {
            const prev = this.todoBlockBeforeRewrite;
            this.todoBlockBeforeRewrite = null;
            this.removeSilentTodoToolBlock(block, id);
            if (prev) {
              prev.setDone(result, durationMs, { collapsed: false, compact: false });
              this.markLatestTodoBlock(prev);
            }
            if (!this.isRunning) {
              this.tui.requestRender();
              return;
            }
            this.setBusyStatus("Waiting for model ...", BUSY_PROCESSING);
            this.updateLiveMetrics(result.output.length, true);
            this.requestRenderForPhase("tool_end_todo_cosmetic");
            return;
          }

          const compact =
            this.compactToolOutputEnabled &&
            shouldCompactToolOutput(_name, result.success, result.metadata);
          const collapsed =
            _name === "task" || compact || (_name === "question" && result.success);
          if (compact) this.lastExpandableTool = block;
          block.setDone(result, durationMs, { collapsed, compact });
          this.lastBandToolHadBody = block.hasExpandedBody();
          if (_name === "todo_write" || _name === "todo_read") {
            this.markLatestTodoBlock(block);
          }
          this.toolBlocks.delete(id);
        }
        if (!this.isRunning) {
          this.tui.requestRender();
          return;
        }

          this.setBusyStatus("Waiting for model ...", BUSY_PROCESSING);
        this.updateLiveMetrics(result.output.length, true);
        this.requestRenderForPhase("tool_end");
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
      onAbort: () => {
        this.abortCurrentTurn();
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
    if (autonomousGoalCancelled()) {
      this.spinStop();
      this.isRunning = false;
      this.syncContextBar({ isRunning: false });
      this.tui.setFocus(this.promptInput);
      this.tui.requestRender();
      return;
    }

    await this.loop.run(userMessage, this.mode, events, {
      displayMessage,
      segments: payload.segments,
    });
    if (autonomousGoalCancelled()) return;

    // Auto-off suggestion: all todos complete + advisor workflow ON
    await this.checkAutoOffSuggestion();
  }

  // ?? Helpers ???????????????????????????????????????????????????????????????

  private scheduleStreamRender(): void {
    if (this.streamRenderScheduled) return;
    this.streamRenderScheduled = true;
    setTimeout(() => {
      this.streamRenderScheduled = false;
      this.requestRenderForPhase("stream");
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
        : this.goalState?.status === "paused_judge_unavailable"
          ? "[goal paused — judge unavailable]"
          : undefined;
    this.syncContextBar({ goalLabel: label });
  }

  // No dedicated interval here: while a turn is active the existing
  // spinnerInterval (setBusyStatus, 80ms) already redraws the frame the ba
  // segment derives from Date.now(); while idle the segment renders as a
  // static "ba N" (no glyph), and BgJobEvents.Changed triggers the one-off
  // redraw needed when a job's count changes with no turn active.
  private syncBgContextBar(): void {
    const count = countRunningBgJobs();
    this.syncContextBar({ backgroundCount: count > 0 ? count : undefined });
    this.tui.requestRender();
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
    if (this.presentationDensity === "compact") {
      this.hasTrailingGap = false;
      return null;
    }
    if (this.hasTrailingGap) return null;
    const spacer = new Spacer(1);
    this.chat.addChild(spacer);
    this.hasTrailingGap = true;
    return spacer;
  }

  /** Review a conversational plan and route execution through explicit user authority. */
  private async showPlanApprovalOverlay(input: {
    planPath: string;
    summary: string;
    planMarkdown: string;
  }): Promise<"preview" | "agent" | "revise" | "stay"> {
    if (!this.tui) return "stay";

    const shortPath = input.planPath.replace(
      new RegExp(`^${os.homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      "~"
    );

    const overlay = new PlanApprovalOverlay({
      planPath: shortPath,
      summary: input.summary,
      planMarkdown: input.planMarkdown,
      presentationDensity: this.presentationDensity,
      mode: this.mode,
    });

    return new Promise<"preview" | "agent" | "revise" | "stay">((resolve) => {
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
        void (async () => {
        this.dismissPlanApprovalOverlay();
        if (decision === "preview") {
          await this.runSafePreviewRequest(
            `Implement this reviewed plan:\n\n${input.planMarkdown}`,
            input.summary
          );
          this.addChatLine(advisorStatusLine("Plan sent to isolated preview"));
        } else if (decision === "agent") {
          const changed = await this.applyModeChange("AGENT", {
            prev: this.mode,
            source: "explicit-user-transition",
          });
          this.addChatLine(advisorStatusLine(
            changed || this.mode === "AGENT"
              ? "Plan approved · AGENT authority active"
              : "Plan remains read-only · AGENT transition failed"
          ));
        } else if (decision === "revise") {
          this.addChatLine(advisorStatusLine(
            `Plan revision requested · authority remains ${this.mode}`
          ));
        } else {
          this.addChatLine(advisorStatusLine(
            `Plan not executed · authority remains ${this.mode}`
          ));
        }
        this.tui.setFocus(this.promptInput);
        this.tui.requestRender();
        resolve(decision);
        })();
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

  /** Request a layout refresh after content above the prompt changes. */
  private requestLayoutRefresh(): void {
    this.requestRenderForPhase("layout");
  }

  // ?? Slash autocomplete ????????????????????????????????????????????????????

  private slashCommands(): SlashCommandEntry[] {
    return buildTopLevelSlashCommandList({
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

    const lines = renderSlashAutocompleteLines(
      val,
      this.slashCommands(),
      this.terminal.columns
    );
    this.autocompleteText.setText(lines.join("\n"));
    this.requestLayoutRefresh();
  }

  // ?? Exit ??????????????????????????????????????????????????????????????????

  private clearRevokedUserShellUi(): void {
    this.shellCommandRunning = false;
    this.shellTakeoverActive = false;
    this.shellEscArmed = false;
    if (this.shellEscTimer) clearTimeout(this.shellEscTimer);
    this.activeShellBlock?.setInteractiveHint(false);
    this.activeShellBlock?.setTakeoverActive(false);
    this.activeShellBlock?.setCancelled();
    this.activeShellBlock = null;
  }

  private async cleanupExecutionForLifecycle(
    context: ExecutionCleanupContext
  ): Promise<boolean> {
    const cleanup = await cleanupExecutionParticipants(context);
    if (cleanup.stoppedShells > 0) this.clearRevokedUserShellUi();
    this.syncBgContextBar();
    if (!cleanup.ok) {
      this.addChatLine(clr.warn(cleanup.notice ?? "Lifecycle cleanup failed"));
      this.tui.requestRender();
      return false;
    }
    return true;
  }

  private async flushSessionForLifecycle(
    context: "exit" | "update" | "tui-stop"
  ): Promise<boolean> {
    const expected = SessionManager.captureCurrentSessionMutation();
    const label = context === "exit"
      ? "Exit"
      : context === "update"
        ? "Update relaunch"
        : "Action";
    try {
      const result = await SessionManager.flushCurrent();
      const persisted = expected === null
        ? result.status === "no-session"
        : result.status === "persisted" &&
          result.sessionID === expected.sessionID &&
          result.generation === expected.generation;
      if (persisted) return true;
      const reason = result.status === "dirty"
        ? `session remained dirty after ${result.attempts} save attempts`
        : "session changed before save completed";
      this.addChatLine(clr.warn(`${label} blocked -- ${reason}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addChatLine(clr.warn(`${label} blocked -- session save failed: ${message}`));
    }

    if (this.mode === "AGENT") restoreAgentAuthorityAfterLifecycle();
    else restoreAskExecutionAdmissionAfterFailure();
    this.tui.requestRender();
    this.drainTurnQueue();
    return false;
  }

  private async gracefulExit(): Promise<void> {
    if (!(await this.cleanupExecutionForLifecycle("exit"))) return;
    if (!(await this.flushSessionForLifecycle("exit"))) return;
    clearActiveSessionMarker();
    const session = SessionManager.getCurrentSession();
    const config = await loadConfig();
    this.branchWatcher?.dispose();
    await this.loop.dispose();
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
    const separator = this.nextTurnSegmentSeparator;
    this.nextTurnSegmentSeparator = "\n\n";
    this.currentTurnAssistantText = this.currentTurnAssistantText
      ? `${this.currentTurnAssistantText}${separator}${trimmed}`
      : trimmed;
  }

  private freezeStreamingSplit(split: StreamSplit): void {
    if (!this.streamingText) return;
    this.streamingText.setText(split.frozen);
    this.appendAssistantTurnSegment(split.frozen);
    if (split.kind === "paragraph") {
      this.addSectionGap();
    } else {
      this.nextTurnSegmentSeparator = "\n";
    }
    this.streamingRaw = split.remainder;
    this.streamingText = null;
  }

  private freezeStreamingAtSafeBoundary(allowLineCut: boolean): boolean {
    if (!this.streamingText || !this.streamingRaw) return false;
    const split = splitAtSafeBoundary(this.streamingRaw, { allowLineCut });
    if (!split) return false;

    this.freezeStreamingSplit(split);
    return true;
  }

  private prepareStreamingToken(incomingToken: string): string {
    if (!this.streamingText || !this.tui) {
      return `${this.streamingRaw}${incomingToken}`;
    }
    const rows = this.tui.terminal?.rows ?? this.terminal.rows ?? 24;
    const softLimit = Math.max(
      8,
      Math.min(ImpulseRenderer.MAX_MUTABLE_STREAM_LINES, Math.floor(rows / 3))
    );
    const renderedLines = this.streamingText.render(this.terminalCols()).length;
    const hardLimit = Math.max(
      softLimit * 2,
      ImpulseRenderer.MAX_MUTABLE_STREAM_LINES_HARD
    );
    const plan = planStreamingRotation({
      raw: this.streamingRaw,
      incomingToken,
      renderedLines,
      softLimit,
      hardLimit,
    });
    if (plan.split) {
      this.freezeStreamingSplit(plan.split);
    }
    return plan.nextRaw;
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

  private finalizeStreamingAtSafeBoundary(gapAfter: boolean): void {
    if (!this.streamingText) {
      this.finalizeAssistantStreamingSegment(gapAfter);
      return;
    }
    const froze = this.freezeStreamingAtSafeBoundary(true);
    if (froze) {
      if (gapAfter) {
        this.addSectionGap();
      }
      return;
    }

    this.finalizeAssistantStreamingSegment(gapAfter);
  }

  private closeThinking(): void {
    if (this.thinkingOpen && this.thinkingText) {
      if (this.thinkingStartedAt > 0) {
        this.thinkingElapsedMs += Date.now() - this.thinkingStartedAt;
        this.thinkingStartedAt = 0;
      }
      const durationMs = this.thinkingElapsedMs;
      if (this.thinkingDisplay !== "off" && this.thinkingRaw.trim()) {
        this.thinkingText.setText(this.thinkingRaw);
      }
      this.thinkingText.finalize(durationMs);
      if (this.thinkingDisplay === "off") {
        this.thinkingText.setHidden();
      }
      this.lastExpandableThinking = this.thinkingText;
      if (this.thinkingDisplay === "full") {
        this.thinkingText.setExpanded(true);
      }
      debugLog(`Thinking block closed (${durationMs}ms)`);
      if (this.thinkingDisplay !== "off") this.addSectionGap();
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
      cmdBa: (arg) => r.cmdBa(arg),
      cmdSkills: (arg) => r.cmdSkills(arg),
      cmdRunSkillCommand: (slug, arg) => r.cmdRunSkillCommand(slug, arg),
      cmdAdvisor: (arg) => r.cmdAdvisor(arg),
      cmdExperimental: () => r.cmdExperimental(),
      cmdSettings: () => r.cmdSettings(),
      cmdInstructions: (arg) => r.cmdInstructions(arg),
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
    if (!(await this.cleanupExecutionForLifecycle("new-session"))) return;
    this.syncBgContextBar();
    const creation = await createNewSessionWithAuthority({
      currentMode: this.mode,
      create: async () => {
        const newCfg = await loadConfig();
        SessionManager.setOptions({ defaultModel: newCfg.defaultModel ?? "" });
        return SessionManager.createNew(arg || undefined);
      },
    });
    if (!creation.ok) {
      this.mode = creation.mode;
      this.syncContextBar({ mode: creation.mode });
      this.syncModeColor();
      this.addChatLine(clr.warn(creation.notice));
      this.tui.requestRender();
      this.drainTurnQueue();
      return;
    }
    clearShellSessions();
    clearProjectStructureCache();
    this.syncApprovalPolicyUi();
    this.speedoEnabled = false;
    this.syncSpeedoUi();
    this.promptHistory.resetIndex();
    this.resetTurnUiState();
    this.clearChatView();
    this.addChatLine(clr.dim("New session started"));
    const session = creation.session;
    this.applySessionToRenderer(session, normalizeMode(session.mode));
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
    this.requestLayoutRefresh();
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
      this.requestLayoutRefresh();
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
      this.requestLayoutRefresh();
      return;
    }

    // Advisor workflow: only save advisorModel, don't change default provider/model
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
      this.requestLayoutRefresh();
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
    if (this.showAgentAuthorityRequirement("install updates")) return;
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
    if (!(await this.cleanupExecutionForLifecycle("update"))) return;
    if (!(await this.flushSessionForLifecycle("update"))) return;
    this.addChatLine(clr.dim("Installing update and relaunching..."));
    this.tui.requestRender();
    const session = SessionManager.getCurrentSession();
    const child = spawn(impulseCommand(), ["--auto-update"], {
      detached: true,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: {
        ...process.env,
        [INTERNAL_AUTO_UPDATE_ENV]: "1",
        [UPDATE_PARENT_PID_ENV]: String(process.pid),
      },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("spawn", () => resolve());
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.addChatLine(clr.error(`Failed to start update: ${message}`));
      this.tui.requestRender();
      return;
    }
    if (session?.id) {
      writeUpdateResumeHint(session.id);
    }
    clearActiveSessionMarker();
    await this.loop.dispose();
    this.tui.stop();
    child.unref();
    process.exit(0);
  }

  private setupPurpose(state: ModelSetupState): "worker" | "vision" | "advisor" | "subagent" {
    if (state.setupPurpose) return state.setupPurpose;
    if (state.isAdvisorMode) return "advisor";
    return "worker";
  }

  private syncDisplaySettingsFromConfig(config: Config): void {
    this.presentationDensity = config.presentationDensity ?? "compact";
    this.thinkingDisplay = config.thinkingDisplay ?? "summary";
    this.responsePreference = config.userProfile?.responsePreference?.trim() || "balanced";
    this.compactToolOutputEnabled = config.compactToolOutput ?? true;
    this.contextBar?.update({
      bottomBarVisual: config.bottomBarVisual ?? "full",
      presentationDensity: this.presentationDensity,
    });
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
    } else if (this.thinkingDisplay === "summary") {
      this.thinkingText.setPlaceholder();
    } else {
      this.thinkingText.setHidden();
    }
  }

  private thinkingTruncateDisplay(): boolean {
    return this.responsePreference === "concise";
  }

  private appendWorkerThinking(text: string): void {
    const filtered = filterThinkingForDisplay(text);
    if (!this.thinkingOpen) {
      // An empty/whitespace-only delta (some providers emit these) must never
      // open a visible-nothing thinking block and hard-cut the streaming text
      // for it — that's the interleaved-reasoning half of #127.
      if (!filtered.trim()) return;
      this.setBusyStatus("Thinking ...", BUSY_PROCESSING);
      this.finalizeStreamingAtSafeBoundary(false);
      this.thinkingRaw = "";
      this.thinkingText = null;
    } else {
      this.setBusyStatus("Thinking ...", BUSY_PROCESSING);
    }
    if (!this.thinkingText) {
      if (this.thinkingDisplay !== "off") this.addSectionGap();
      this.thinkingText = new ThinkingBlock();
      this.thinkingText.setTruncateDisplay(this.thinkingTruncateDisplay());
      this.chat.addChild(this.thinkingText);
      this.lastExpandableThinking = this.thinkingText;
      this.hasTrailingGap = false;
      this.thinkingOpen = true;
      this.thinkingStartedAt = Date.now();
    }
    this.thinkingRaw += filtered;
    this.thinkingText.appendContent(filtered);
    if (this.thinkingDisplay === "summary") {
      this.thinkingText.setPlaceholder();
    } else if (this.thinkingDisplay === "off") {
      this.thinkingText.setHidden();
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
    if (this.showAgentAuthorityRequirement("create or restore project checkpoints")) return;
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
    if (this.showAgentAuthorityRequirement("create or restore project checkpoints")) return;
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
    if (this.showAgentAuthorityRequirement("create or restore project checkpoints")) return;
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
    const trimmedArg = arg.trim();
    const tokens = trimmedArg.split(/\s+/).filter(Boolean);
    const firstToken = (tokens[0] ?? "").toLowerCase();

    if (!trimmedArg) {
      this.addChatLine(
        clr.dim("Usage: /goal <text> | set [--plan[=revisionId]] <text> | status | pause | resume | clear")
      );
      this.tui.requestRender();
      return;
    }
    if (firstToken === "status") {
      if (!this.goalState) {
        this.addChatLine(clr.dim("No active goal"));
      } else {
        const planSuffix = this.goalState.planRevisionId
          ? `, plan: ${this.goalState.planRevisionId}`
          : "";
        this.addChatLine(
          clr.dim(
            `${this.goalState.status} — ${this.goalState.turnsUsed}/${this.goalState.maxTurns} turns${planSuffix}: ${this.goalState.text}`
          )
        );
      }
      this.tui.requestRender();
      return;
    }
    if (this.showAgentAuthorityRequirement("change persistent goal state")) return;
    if (firstToken === "clear") {
      this.goalState = undefined;
      await this.persistGoalState();
      this.syncGoalContextBar();
      void this.emitStatusEvent("Goal cleared");
      this.tui.requestRender();
      return;
    }
    if (firstToken === "pause") {
      if (this.goalState) {
        this.goalState = { ...this.goalState, status: "paused" };
        await this.persistGoalState();
        this.syncGoalContextBar();
        void this.emitStatusEvent("Goal paused");
      }
      this.tui.requestRender();
      return;
    }
    if (firstToken === "resume") {
      if (this.goalState) {
        const wasJudgePause = this.goalState.status === "paused_judge_unavailable";
        this.goalState = {
          ...this.goalState,
          status: "active",
          // Preserve turnsUsed for judge pauses — no work-turn was consumed
          ...(wasJudgePause ? {} : { turnsUsed: 0 }),
        };
        await this.persistGoalState();
        this.syncGoalContextBar();
        if (this.goalState.planRevisionId) {
          const sessionId = SessionManager.getCurrentSessionID() ?? "";
          if (!readPlanTasksMarkdown(sessionId, this.goalState.planRevisionId)) {
            this.addChatLine(
              clr.warn(
                `Plan revision ${this.goalState.planRevisionId} not found — judging against goal text only.`
              )
            );
          }
        }
        void this.emitStatusEvent(
          wasJudgePause ? "Goal resumed" : "Goal resumed — turn counter reset"
        );
      }
      this.tui.requestRender();
      return;
    }
    if (this.isRunning) {
      this.addChatLine(clr.warn("Cannot set goal during an active turn"));
      this.tui.requestRender();
      return;
    }

    if (firstToken === "set") {
      const sessionId = SessionManager.getCurrentSessionID() ?? "";
      let planRevisionId: string | undefined;
      let planRequested = false;
      const textTokens: string[] = [];

      for (const token of tokens.slice(1)) {
        if (token === "--plan") {
          planRequested = true;
          continue;
        }
        if (token.startsWith("--plan=")) {
          planRequested = true;
          planRevisionId = token.slice("--plan=".length);
          continue;
        }
        textTokens.push(token);
      }

      if (planRequested) {
        if (!planRevisionId) {
          const active = getActivePlanRevision(sessionId);
          if (!active) {
            this.addChatLine(
              clr.warn("No active plan revision. Create one first, or specify /goal set --plan=<revisionId>.")
            );
            this.tui.requestRender();
            return;
          }
          planRevisionId = active.meta.revisionId;
        }
        if (!readPlanTasksMarkdown(sessionId, planRevisionId)) {
          const ids = listRevisionIds(sessionId);
          this.addChatLine(
            clr.warn(
              ids.length > 0
                ? `Plan revision '${planRevisionId}' not found (or has no tasks.md). Available revisions: ${ids.join(", ")}.`
                : `Plan revision '${planRevisionId}' not found and no plan revisions exist for this session.`
            )
          );
          this.tui.requestRender();
          return;
        }
      }

      let text = textTokens.join(" ").trim();
      if (!text && planRevisionId) {
        text = `Complete all tasks in plan revision ${planRevisionId} (tasks.md)`;
      }
      if (!text) {
        this.addChatLine(clr.warn("Usage: /goal set [--plan[=revisionId]] <text>"));
        this.tui.requestRender();
        return;
      }

      this.goalState = createGoalState(text, planRevisionId ? { planRevisionId } : undefined);
      await this.persistGoalState();
      this.syncGoalContextBar();
      void this.emitStatusEvent(
        `Goal set: ${this.goalState.text}${planRevisionId ? ` (plan: ${planRevisionId})` : ""}`
      );
      this.tui.requestRender();
      return;
    }

    // Legacy /goal <text>
    this.goalState = createGoalState(trimmedArg);
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
          this.requestLayoutRefresh();
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
      presentationDensity: config.presentationDensity ?? "compact",
      approvalPolicy: effectiveApprovalPolicy(),
      thinkingDisplay: config.thinkingDisplay ?? "summary",
      reasoningLevel: config.reasoningLevel ?? "medium",
      responsePreference: config.userProfile?.responsePreference?.trim() || "balanced",
      statsOnExit: config.statsOnExit ?? false,
      showSubagentThinking: config.showSubagentThinking,
      useSubagentModel: config.useSubagentModel,
      workerModel: config.defaultModel,
      compactToolOutput: config.compactToolOutput ?? true,
      bottomBarVisual: config.bottomBarVisual ?? "full",
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
      config.presentationDensity = values.presentationDensity;
      const approvalChanged = initialValues.approvalPolicy !== values.approvalPolicy;
      if (approvalChanged) config.approvalPolicy = values.approvalPolicy;
      config.showMainThinking = values.thinkingDisplay === "full";
      config.reasoningLevel = values.reasoningLevel;
      config.statsOnExit = values.statsOnExit;
      config.showSubagentThinking = values.showSubagentThinking;
      config.useSubagentModel = values.useSubagentModel;
      config.compactToolOutput = values.compactToolOutput;
      config.bottomBarVisual = values.bottomBarVisual;
      config.visionModelOverride = values.visionModelOverride;
      if (values.subagentModel !== undefined) {
        config.subagentModel = values.subagentModel;
      }
      if (!config.userProfile) {
        config.userProfile = { name: "", responsePreference: "balanced", customInstructions: "" };
      }
      config.userProfile.responsePreference = values.responsePreference;
      await saveConfig(config);
      if (approvalChanged) {
        configureApprovalPolicy({ persisted: values.approvalPolicy });
        this.syncApprovalPolicyUi();
        if (values.approvalPolicy === "allow-all") {
          this.addChatLine(clr.warn("ALLOW-ALL enabled · HOST"));
          this.addChatLine(clr.dim(ALLOW_ALL_WARNING));
        } else {
          this.addChatLine(clr.dim("PROMPT enabled · permission prompts restored"));
        }
      }
      invalidatePromptCache();
      this.reasoningLevel = values.reasoningLevel;
      this.syncDisplaySettingsFromConfig(config);
      this.syncContextBar({ reasoningLevel: this.reasoningDisplayLabel() });
      return "saved";
    };

    await new Promise<void>((resolve) => {
      const rows = this.tui.terminal?.rows ?? this.terminal.rows ?? 24;
      const maxHeight = overlayViewportMaxHeight(rows);
      overlay.setMaxHeight(maxHeight);
      const handle = this.showContentSizedOverlay(overlay, { maxHeight });
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

      const openWorkerPicker = () => {
        void (async () => {
          await applySettingsValues(overlay.getValues());
          this.dismissSettingsOverlay();
          if (countConfiguredProviders(await loadConfig()) === 0) {
            await this.startModelSetup(await loadConfig(), "worker");
            finish();
            return;
          }
          await this.openModelPicker({
            purpose: "worker",
            onComplete: () => finish(),
          });
        })();
      };

      overlay.onAbort = () => finish();

      overlay.onEnableSubagentModel = openSubagentPicker;
      overlay.onPickSubagentModel = openSubagentPicker;
      overlay.onPickWorkerModel = openWorkerPicker;

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
      this.addChatLine(advisorStatusLine("Advisor workflow disabled"));
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
      this.addChatLine(advisorStatusLine("Advisor workflow disabled"));
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
      this.addChatLine(advisorStatusLine(`Advisor: ${arg} (workflow ON)`));
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
      this.addChatLine(advisorStatusLine(`Advisor: ${fullModel} (workflow ON)`));
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

  private async cmdMode(arg: string): Promise<void> {
    const result = resolveModeCommand(arg, this.mode);
    if ("message" in result) {
      this.addChatLine(`  ${result.message}`);
      return;
    }
    if ("nextMode" in result) {
      const prev = this.mode;
      const changed = await this.applyModeChange(result.nextMode, {
        prev,
        source: "explicit-user-transition",
      });
      if (changed) invalidatePromptCache();
      this.tui.requestRender();
      return;
    }
    this.addChatLine(`  ${clr.error("!")} ${result.error}`);
  }

  private syncApprovalPolicyUi(boundary: "HOST" | "SANDBOX" | "PREVIEW" = "HOST"): void {
    this.syncContextBar({
      allowAllBypass: isAllowAllBypass(),
      approvalPolicy: effectiveApprovalPolicy() === "allow-all" ? "ALLOW-ALL" : "PROMPT",
      executionBoundary: boundary,
    });
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

    if (effectiveApprovalPolicy() === "allow-all") {
      const config = await loadConfig();
      config.approvalPolicy = "prompt";
      await saveConfig(config);
      configureApprovalPolicy({ persisted: "prompt" });
      this.syncApprovalPolicyUi();
      this.addChatLine(clr.dim("PROMPT enabled · permission prompts restored"));
      this.tui.requestRender();
      return;
    }

    const agreed = await this.showAllowAllDisclaimer();
    if (!agreed) {
      this.addChatLine(clr.dim("Allow-all not enabled."));
      this.tui.requestRender();
      return;
    }

    const config = await loadConfig();
    config.approvalPolicy = "allow-all";
    await saveConfig(config);
    setPersistedApprovalPolicy("allow-all");
    configureApprovalPolicy({ persisted: "allow-all" });
    this.syncApprovalPolicyUi();
    this.addChatLine(clr.warn("ALLOW-ALL enabled · HOST"));
    this.addChatLine(clr.dim(ALLOW_ALL_WARNING));
    this.tui.requestRender();
  }

  private async cmdUser(_arg: string): Promise<void> {
    if (this.isRunning) return;

    const config = await loadConfig();
    const effectiveInstructions = await loadEffectiveUserInstructions(
      config.userProfile?.customInstructions
    );
    // Always surface file-backed instructions even when userProfile is unset
    // (e.g. agent-only writes to ~/.impulse/user-instructions.md).
    const profile = {
      name: config.userProfile?.name ?? "",
      responsePreference: config.userProfile?.responsePreference ?? "balanced",
      customInstructions: effectiveInstructions.content,
    };
    const overlay = new ProfileOverlay({ profile });

    overlay.onEdit = async () => {
      if (!(await this.cleanupExecutionForLifecycle("tui-stop"))) return;
      if (!(await this.flushSessionForLifecycle("tui-stop"))) return;
      this.profileOverlayHandle?.hide();
      this.profileOverlayHandle = null;
      this.tui.stop();
      const { runOnboarding } = await import("../index.js");
      await runOnboarding();
      const newConfig = await loadConfig();
      this.userName = newConfig.userProfile?.name || "you";
      invalidatePromptCache();
      ensurePiTuiDebugRedrawDir();
      clearTerminalForTuiStart(this.terminal);
      this.tui.start();
      this.tui.setFocus(this.promptInput);
      this.addChatLine(clr.dim("Profile updated"));
      this.tui.requestRender();
    };

    overlay.onEditInstructions = () => {
      this.profileOverlayHandle?.hide();
      this.profileOverlayHandle = null;
      void this.cmdInstructions("");
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

  private dismissInstructionsOverlay(): void {
    this.instructionsOverlayHandle?.hide();
    this.instructionsOverlayHandle = null;
  }

  private beginInstructionsCommand(action: "replace" | "append" | "import"): void {
    this.dismissInstructionsOverlay();
    this.promptInput.clear();
    this.promptInput.setText(`/instructions ${action} `);
    this.tui.setFocus(this.promptInput);
    this.tui.requestRender();
  }

  private async showCurrentUserInstructions(): Promise<void> {
    const config = await loadConfig({ refresh: true });
    const effective = await loadEffectiveUserInstructions(
      config.userProfile?.customInstructions
    );
    this.addChatLine(
      clr.dim(
        `User instructions: ${effective.sourceLabel} (${effective.content.length} chars)`
      )
    );
    if (!effective.content) {
      this.addChatLine(clr.dim("  (none)"));
    } else {
      const lines = effective.content.split("\n");
      for (const line of lines.slice(0, 40)) {
        this.addChatLine(clr.dim(`  ${line}`));
      }
      if (lines.length > 40) {
        this.addChatLine(clr.dim(`  ... ${lines.length - 40} more lines`));
      }
    }
    this.tui.requestRender();
  }

  private async persistInstructionCommand(
    action: "replace" | "append" | "import" | "clear",
    value = ""
  ): Promise<void> {
    if (this.showAgentAuthorityRequirement("change persistent user instructions")) return;
    const stored = await writeUserInstructions(action, value);
    invalidatePromptCache();
    const verb = action === "replace"
      ? "replaced"
      : action === "append"
        ? "appended"
        : action === "import"
          ? "imported"
          : "cleared";
    this.addChatLine(
      clr.dim(
        `User instructions ${verb}: ${USER_INSTRUCTIONS_DISPLAY_PATH} (${stored.content.length} chars)`
      )
    );
    const allPreviewLines = stored.content.split("\n");
    const previewLines = allPreviewLines.slice(0, 3);
    if (previewLines.length === 1 && previewLines[0] === "") {
      this.addChatLine(clr.dim("  (none)"));
    } else {
      for (const line of previewLines) {
        const compact = line.length > 120 ? `${line.slice(0, 119)}…` : line;
        this.addChatLine(clr.dim(`  ${compact}`));
      }
      if (allPreviewLines.length > previewLines.length) {
        this.addChatLine(clr.dim("  ..."));
      }
    }
    this.tui.requestRender();
  }

  private showInstructionsOverlay(): void {
    this.dismissInstructionsOverlay();
    const rows: SelectableListRow[] = [
      { id: "view", label: "View current instructions" },
    ];
    if (this.mode === "AGENT") {
      rows.push(
        { id: "replace", label: "Replace (paste multiline Markdown)" },
        { id: "append", label: "Append Markdown" },
        { id: "import", label: "Import @path" },
        { id: "clear", label: "Clear instructions" },
      );
    }
    const overlay = new SelectableListOverlay({
      title: "User instructions",
      rows,
      boxSizing: "responsive",
      maxHeight: 12,
      helpLines: ["Up/Down navigate   Enter select   Esc close"],
    });
    overlay.onSelect = (id) => {
      this.dismissInstructionsOverlay();
      if (id === "view") {
        void this.cmdInstructions("view");
      } else if (id === "replace" || id === "append" || id === "import") {
        this.beginInstructionsCommand(id);
      } else if (id === "clear") {
        void this.cmdInstructions("clear");
      }
    };
    overlay.onCancel = () => {
      this.dismissInstructionsOverlay();
      this.tui.setFocus(this.promptInput);
    };
    this.instructionsOverlayHandle = this.showListOverlay(overlay);
  }

  private async cmdInstructions(arg: string): Promise<void> {
    if (this.isRunning) {
      this.addChatLine(clr.warn("Wait for the current turn to finish."));
      this.tui.requestRender();
      return;
    }

    this.promptInput.clear();
    const actionMatch = arg.match(/^(\S+)(?:[ \t]+([\s\S]*))?$/);
    const rawAction = actionMatch?.[1]?.toLowerCase() ?? "";
    const value = actionMatch?.[2] ?? "";

    try {
      if (!rawAction) {
        this.showInstructionsOverlay();
        return;
      }
      const actionResult = InstructionsCommandActionSchema.safeParse(rawAction);
      if (!actionResult.success) {
        this.addChatLine(
          clr.dim(
            "Usage: /instructions [view | replace <text> | append <text> | import @path | clear]"
          )
        );
        this.tui.requestRender();
        return;
      }
      const action = actionResult.data;
      if (action === "view" || action === "show") {
        await this.showCurrentUserInstructions();
        return;
      }
      if (this.showAgentAuthorityRequirement("change persistent user instructions")) return;
      if (action === "replace" || action === "set" || action === "append") {
        const normalizedAction = action === "append" ? "append" : "replace";
        if (!value) {
          this.beginInstructionsCommand(normalizedAction);
          return;
        }
        await this.persistInstructionCommand(normalizedAction, value);
        return;
      }
      if (action === "import") {
        if (!value.trim()) {
          this.beginInstructionsCommand("import");
          return;
        }
        await this.persistInstructionCommand("import", value.trim());
        return;
      }
      if (action === "clear") {
        await this.persistInstructionCommand("clear");
        return;
      }
    } catch (error) {
      this.addChatLine(clr.warn(error instanceof Error ? error.message : String(error)));
      this.tui.requestRender();
    }
  }

  private clearChatView(): void {
    const children = (this.chat as Container & { children: Component[] }).children;
    while (children.length > this.welcomeChildCount) {
      children.pop();
    }
    this.hasTrailingGap = false;
    this.lastHeaderLineTitle = null;
  }

  private resetTurnUiState(): void {
    this.toolBlocks.clear();
    this.taskCodenames.clear();
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
      presentationDensity: this.presentationDensity,
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

  private applySessionToRenderer(
    session: import("../session/store.js").Session,
    mode: Mode
  ): void {
    void this.defaultSkillScaffolding.initialize(mode, "session-resume");
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
        if (this.thinkingDisplay !== "off") this.addSectionGap();
        const block = new ThinkingBlock();
        block.setTruncateDisplay(this.thinkingTruncateDisplay());
        block.setText(filtered);
        block.finalize(step.durationMs ?? 0);
        if (this.thinkingDisplay === "full") {
          block.setExpanded(true);
        } else if (this.thinkingDisplay === "off") {
          block.setHidden();
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
          step.durationMs,
          { presentationDensity: this.presentationDensity }
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

  private async resolveSessionResume(
    sessionID: string
  ): Promise<ResumeAuthorityResult<Session>> {
    return resumeSessionWithAuthority({
      currentMode: this.mode,
      inspect: () => SessionManager.inspectForResume(sessionID),
      commit: () => SessionManager.load(sessionID),
    });
  }

  private applyResolvedResume(result: ResumeAuthorityResult<Session>): void {
    const session = result.session;
    if (!result.ok || !session) return;

    if (result.stoppedShells > 0 || this.shellCommandRunning) {
      this.clearRevokedUserShellUi();
    }
    this.syncApprovalPolicyUi();
    this.resetTurnUiState();
    this.clearChatView();
    this.applySessionToRenderer(session, result.mode);
    this.showSessionRestored(session);
    if (result.notice) {
      this.addChatLine(result.mode === "AGENT" ? clr.warn(result.notice) : clr.dim(result.notice));
      this.addSectionGap();
    }
    this.hydrateChatFromSession(session);
    this.syncBgContextBar();
    this.tui.requestRender();
  }

  private async applyResumeSession(sessionID: string): Promise<boolean> {
    try {
      const result = await this.resolveSessionResume(sessionID);
      if (!result.ok) {
        if (result.stoppedShells > 0) this.clearRevokedUserShellUi();
        this.addChatLine(clr.warn(result.notice ?? "Resume blocked; execution remains AGENT"));
        this.syncBgContextBar();
        this.tui.requestRender();
        return false;
      }
      this.applyResolvedResume(result);
      return true;
    } catch (e) {
      this.addChatLine(clr.error(`Failed to load session: ${(e as Error).message}`));
      this.tui.requestRender();
      return false;
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

  private async cmdBa(arg: string): Promise<void> {
    const { listBgJobs, killBgJob } = await import("../tools/bg-process-registry.js");
    const parts = arg.trim().split(/\s+/);
    const sub = parts[0]?.toLowerCase() ?? "";

    if (!sub || sub === "list") {
      const jobs = listBgJobs();
      if (jobs.length === 0) {
        this.addChatLine(clr.dim("No background jobs."));
      } else {
        this.addChatLine(clr.dim(`Background jobs (${jobs.length}):`));
        for (const j of jobs) {
          const dur = j.endedAt
            ? `${Math.round((j.endedAt - j.startedAt) / 1000)}s`
            : `${Math.round((Date.now() - j.startedAt) / 1000)}s running`;
          this.addChatLine(clr.dim(`  ${j.id} [${j.status}] ${dur}  ${j.command.slice(0, 60)}`));
        }
      }
      this.tui.requestRender();
      return;
    }

    const id = parts[1] ?? "";
    if (!id) {
      this.addChatLine(clr.dim(`Usage: /ba ${sub} <id>`));
      this.tui.requestRender();
      return;
    }

    if (sub === "kill") {
      if (this.showAgentAuthorityRequirement("kill or restart background jobs")) return;
      const ok = await killBgJob(id);
      this.addChatLine(ok ? clr.dim(`Job '${id}' killed.`) : clr.warn(`No running job '${id}'.`));
      this.syncBgContextBar();
      this.tui.requestRender();
      return;
    }

    if (sub === "restart") {
      if (this.showAgentAuthorityRequirement("kill or restart background jobs")) return;
      const { restartBgJob } = await import("../tools/bash.js");
      const result = await restartBgJob(id);
      if (result.ok) {
        const pidNote = result.pid ? ` (pid ${result.pid})` : "";
        this.addChatLine(clr.dim(`Job '${id}' restarted as '${result.newJobId}'${pidNote}.`));
      } else {
        this.addChatLine(clr.warn(result.error));
      }
      this.syncBgContextBar();
      this.tui.requestRender();
      return;
    }

    this.addChatLine(clr.dim("Usage: /ba [list] | kill <id> | restart <id>"));
    this.tui.requestRender();
  }

  private dismissSkillsOverlay(): void {
    this.skillsOverlayHandle?.hide();
    this.skillsOverlayHandle = null;
  }

  private async cmdSkills(_arg: string): Promise<void> {
    const skills = listInstalledSkills(process.cwd());
    // Overlays are input-modal; keep the plain-text listing while a turn is running.
    if (this.isRunning) {
      if (skills.length === 0) {
        this.addChatLine(clr.dim("No skills installed."));
        this.tui.requestRender();
        return;
      }
      this.addChatLine(clr.dim(`Installed skills (${skills.length}):`));
      for (const s of skills) {
        const desc = s.description ? ` — ${s.description}` : "";
        this.addChatLine(clr.dim(`  ${s.slug}${desc}`));
      }
      this.tui.requestRender();
      return;
    }
    this.showSkillsListOverlay(skills);
  }

  private showSkillsListOverlay(skills: InstalledSkillMeta[]): void {
    this.dismissSkillsOverlay();
    const overlay = createSkillsListOverlay(
      skills,
      LIST_OVERLAY_MAX_HEIGHT,
      this.mode,
      this.presentationDensity
    );
    overlay.onSelect = (slug) => {
      this.dismissSkillsOverlay();
      if (slug === "skills:empty") {
        this.showSkillsListOverlay(listInstalledSkills(process.cwd()));
        return;
      }
      if (slug === "skills:install") {
        if (this.showAgentAuthorityRequirement("install skills")) return;
        void this.runSkillAgentTurn(
          "Install an agent skill with install_skill. Ask for the full owner/repo/path or GitHub skill-folder URL before installing anything.",
          "Install skill"
        );
        return;
      }
      const skill = skills.find((s) => s.slug === slug);
      if (skill) this.showSkillActionOverlay(skill);
    };
    overlay.onCancel = () => {
      this.dismissSkillsOverlay();
      this.tui.setFocus(this.promptInput);
    };
    this.skillsOverlayHandle = this.showListOverlay(overlay);
  }

  private showSkillActionOverlay(skill: InstalledSkillMeta): void {
    const overlay = createSkillActionOverlay(
      skill,
      LIST_OVERLAY_MAX_HEIGHT,
      this.mode,
      this.presentationDensity
    );
    overlay.onSelect = (id) => {
      this.dismissSkillsOverlay();
      if (id === "inspect") {
        this.viewSkill(skill);
      } else if (id === "use") {
        void this.cmdRunSkillCommand(skill.slug, "");
      } else if (id === "modify") {
        if (this.showAgentAuthorityRequirement("create, modify, or remove skills")) return;
        void this.runSkillAgentTurn(
          `Modify the existing skill '${skill.slug}'. Read its current SKILL.md first, then use skill_write to update it. Ask what changes I'd like.`,
          `Modify skill: ${skill.slug}`
        );
      } else if (id === "remove") {
        if (this.showAgentAuthorityRequirement("create, modify, or remove skills")) return;
        this.showSkillRemoveConfirmOverlay(skill);
      }
    };
    overlay.onCancel = () => {
      this.dismissSkillsOverlay();
      this.showSkillsListOverlay(listInstalledSkills(process.cwd()));
    };
    this.skillsOverlayHandle = this.showListOverlay(overlay);
  }

  private viewSkill(skill: InstalledSkillMeta): void {
    try {
      const content = fs.readFileSync(skill.path, "utf-8");
      const lines = content.split("\n").slice(0, 20);
      this.addChatLine(clr.dim(`${skill.path}:`));
      for (const line of lines) this.addChatLine(clr.dim(`  ${line}`));
    } catch {
      this.addChatLine(clr.warn(`Could not read ${skill.path}`));
    }
    this.tui.setFocus(this.promptInput);
    this.tui.requestRender();
  }

  private showSkillRemoveConfirmOverlay(skill: InstalledSkillMeta): void {
    if (this.showAgentAuthorityRequirement("create, modify, or remove skills")) return;
    const rows: SelectableListRow[] = [
      { id: "cancel", label: "Cancel" },
      { id: "remove", label: "Remove" },
    ];
    const overlay = new SelectableListOverlay({
      title: `Remove skill: ${skill.slug}`,
      rows,
      boxSizing: "content",
      maxHeight: 10,
      helpLines: [`Deletes .agents/skills/${skill.slug}/`],
    });
    overlay.onSelect = (id) => {
      this.dismissSkillsOverlay();
      if (id === "remove") {
        const result = removeSkill(process.cwd(), skill.slug);
        this.addChatLine(result.success ? clr.dim(result.message) : clr.warn(result.message));
      }
      this.tui.setFocus(this.promptInput);
      this.tui.requestRender();
    };
    overlay.onCancel = () => {
      this.dismissSkillsOverlay();
      this.tui.setFocus(this.promptInput);
    };
    this.skillsOverlayHandle = this.showListOverlay(overlay);
  }

  private async cmdRunSkillCommand(slug: string, arg: string): Promise<void> {
    if (this.isRunning) {
      this.addChatLine(clr.warn("Wait for the current turn to finish."));
      this.tui.requestRender();
      return;
    }
    const skillPath = path.join(process.cwd(), ".agents", "skills", slug, "SKILL.md");
    if (!fs.existsSync(skillPath)) {
      this.addChatLine(clr.warn(`Skill '${slug}' not found.`));
      this.tui.requestRender();
      return;
    }
    const skillContent = fs.readFileSync(skillPath, "utf-8");
    const userMessage = arg
      ? `Execute the following skill:\n\n${skillContent}\n\nUser input: ${arg}`
      : `Execute the following skill:\n\n${skillContent}`;
    await this.runSkillAgentTurn(userMessage, `Skill: ${slug}`);
  }

  private async runSkillAgentTurn(userMessage: string, displayLabel: string): Promise<void> {
    this.isRunning = true;
    this.loop.setImages([]);
    this.addSectionGap();
    this.addChatLine(`${A.fg(36, this.userName)}`);
    this.addChatLine(displayLabel);
    this.addSectionGap();

    this.streamingRaw = "";
    this.streamingText = null;

    const events: LoopEvents = {
      onTurnStart: () => {
        this.setBusyStatus("", "Working on skill..");
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
        this.requestLayoutRefresh();
      },
      onThinking: (text) => {
        this.appendWorkerThinking(text);
        this.requestLayoutRefresh();
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
      onAbort: () => {
        this.spinStop();
        this.isRunning = false;
        this.syncContextBar({ isRunning: false });
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
        displayMessage: displayLabel,
        segments: [{ kind: "text", value: userMessage }],
      });
    } catch {
      this.isRunning = false;
      this.drainTurnQueue();
    }
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
        this.requestLayoutRefresh();
      },
      onThinking: (text) => {
        this.appendWorkerThinking(text);
        this.requestLayoutRefresh();
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
      onAbort: () => {
        this.spinStop();
        this.isRunning = false;
        this.syncContextBar({ isRunning: false });
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
