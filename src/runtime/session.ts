import { randomUUID } from "crypto";
import { isAbsolute, resolve } from "path";
import {
  createHostExecutionBoundary,
  type ExecutionBoundary,
} from "../execution/boundary.js";
import { runWithExecutionContext } from "../execution/context.js";
import type {
  RuntimeConfig,
  RuntimeConfigKey,
  RuntimeEvent,
  RuntimeHistoryBinding,
  RuntimeHistoryMessage,
  RuntimePermissionOutcome,
  RuntimePermissionRequest,
  RuntimePlanEntry,
  RuntimePrompt,
  RuntimeQuestionOutcome,
  RuntimeQuestionRequest,
  RuntimeSessionSnapshot,
  RuntimeTurnDriver,
  RuntimeTurnResult,
  RuntimeMode,
  RuntimeSessionToolProvider,
} from "./types.js";

export type * from "./types.js";

const DEFAULT_CONFIG: RuntimeConfig = {
  density: "compact",
  thinkingDisplay: "summary",
  reasoningLevel: "medium",
  communicationStyle: "balanced",
  approvalPolicy: "prompt",
};

class MemoryHistoryBinding implements RuntimeHistoryBinding {
  private readonly messages: RuntimeHistoryMessage[] = [];

  async load(): Promise<RuntimeHistoryMessage[]> {
    return this.messages.map((message) => ({ ...message }));
  }

  async append(message: RuntimeHistoryMessage): Promise<void> {
    this.messages.push({ ...message });
  }

  async close(): Promise<void> {}
}

export interface RuntimeSessionInput {
  id?: string;
  cwd: string;
  additionalRoots?: string[];
  mode?: RuntimeMode;
  config?: Partial<RuntimeConfig>;
  boundary?: ExecutionBoundary;
  history?: RuntimeHistoryBinding;
  resources?: RuntimeSessionResource[];
  tools?: RuntimeSessionToolProvider;
  /** Compatibility edge for the TUI, whose existing overlays own ambient tool interactions. */
  ambientExecutionContext?: boolean;
}

export interface RuntimeSessionResource {
  id: string;
  close(): Promise<void> | void;
}

export interface HeadlessRuntimeOptions {
  turnDriver: RuntimeTurnDriver;
  launchApprovalPolicy?: "prompt" | "allow-all";
}

type RuntimeListener = (event: RuntimeEvent) => void;
type PendingPermission = { resolve(outcome: RuntimePermissionOutcome): void };
type PendingQuestion = { resolve(outcome: RuntimeQuestionOutcome): void };

export class RuntimeSession {
  readonly id: string;
  readonly cwd: string;
  readonly additionalRoots: string[];
  private mode: RuntimeMode;
  private config: RuntimeConfig;
  private readonly launchApprovalPolicy: "prompt" | "allow-all" | undefined;
  private readonly boundary: ExecutionBoundary;
  private readonly history: RuntimeHistoryBinding;
  private readonly resources: RuntimeSessionResource[];
  private readonly tools: RuntimeSessionToolProvider | undefined;
  private readonly ambientExecutionContext: boolean;
  private historySnapshot: RuntimeHistoryMessage[] = [];
  private historyLoad: Promise<void> | undefined;
  private historyWrites: Promise<void> = Promise.resolve();
  private historyWriteError: unknown;
  private readonly listeners = new Set<RuntimeListener>();
  private activeController: AbortController | undefined;
  private activeTurn: Promise<RuntimeTurnResult> | undefined;
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private readonly pendingQuestions = new Map<string, PendingQuestion>();
  private plan: { id: string; title?: string; entries: RuntimePlanEntry[] } | undefined;
  private lifecycle: "open" | "closing" | "closed" = "open";
  private mutationAdmissionOpen: boolean;
  private stateTransition: Promise<void> = Promise.resolve();
  private readonly completedCleanup = new Set<string>();

  constructor(
    private readonly driver: RuntimeTurnDriver,
    input: RuntimeSessionInput,
    launchApprovalPolicy?: "prompt" | "allow-all"
  ) {
    if (!isAbsolute(input.cwd)) throw new Error("Runtime session cwd must be absolute.");
    const additionalRoots = input.additionalRoots ?? [];
    if (additionalRoots.some((root) => !isAbsolute(root))) {
      throw new Error("Runtime session additional roots must be absolute.");
    }
    this.id = input.id ?? randomUUID();
    this.cwd = resolve(input.cwd);
    this.additionalRoots = additionalRoots.map((root) => resolve(root));
    this.mode = input.mode ?? "ASK";
    this.config = {
      ...DEFAULT_CONFIG,
      ...input.config,
    };
    this.launchApprovalPolicy = launchApprovalPolicy;
    this.boundary = input.boundary ?? createHostExecutionBoundary({
      workspaceRoot: this.cwd,
      additionalRoots: this.additionalRoots,
    });
    this.history = input.history ?? new MemoryHistoryBinding();
    this.resources = [...(input.resources ?? [])];
    this.tools = input.tools;
    const resourceIds = new Set(this.resources.map((resource) => resource.id));
    if (resourceIds.size !== this.resources.length) {
      throw new Error("Runtime session resource IDs must be unique.");
    }
    this.ambientExecutionContext = input.ambientExecutionContext !== false;
    this.mutationAdmissionOpen = this.mode === "AGENT";
  }

  onEvent(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): RuntimeSessionSnapshot {
    const config = this.effectiveConfig();
    return {
      id: this.id,
      cwd: this.cwd,
      additionalRoots: [...this.additionalRoots],
      mode: this.mode,
      approvalPolicy: config.approvalPolicy,
      boundary: { ...this.boundary.descriptor },
      config,
      history: this.historySnapshot.map((message) => ({ ...message })),
      pendingPermissionIds: [...this.pendingPermissions.keys()],
      pendingQuestionIds: [...this.pendingQuestions.keys()],
      ...(this.plan
        ? { plan: { ...this.plan, entries: this.plan.entries.map((entry) => ({ ...entry })) } }
        : {}),
      turnActive: this.activeTurn !== undefined,
      closed: this.lifecycle === "closed",
    };
  }

  setMode(mode: RuntimeMode): void {
    this.ensureOpen();
    if (this.mode === mode) return;
    if (mode === "ASK" && this.activeTurn) {
      this.mutationAdmissionOpen = false;
      this.activeController?.abort();
      this.cancelPendingInteractions("Authority changed to ASK.");
      void this.transitionMode("ASK").catch((error) => {
        this.emit({
          type: "turn-error",
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });
      return;
    }
    this.commitMode(mode);
  }

  async transitionMode(mode: RuntimeMode): Promise<void> {
    return this.serializeStateTransition(async () => {
      this.ensureOpen();
      if (this.mode === mode) return;
      if (mode === "ASK") {
        // Close mutation admission before taking the active-turn snapshot so
        // no late tool/process start can race the authority downgrade.
        this.mutationAdmissionOpen = false;
        const activeTurn = this.activeTurn;
        this.activeController?.abort();
        this.cancelPendingInteractions("Authority changed to ASK.");
        await activeTurn?.catch(() => undefined);
        this.ensureOpen();
        this.commitMode("ASK");
        return;
      }
      this.commitMode("AGENT");
    });
  }

  setConfig<K extends RuntimeConfigKey>(key: K, value: RuntimeConfig[K]): void {
    this.ensureOpen();
    this.config = { ...this.config, [key]: value };
    this.emit({ type: "config", config: this.effectiveConfig() });
  }

  async run(prompt: RuntimePrompt): Promise<RuntimeTurnResult> {
    this.ensureOpen();
    if (this.activeTurn) throw new Error(`Session ${this.id} already has an active turn.`);
    const controller = new AbortController();
    this.activeController = controller;
    const operation = this.runTurn(prompt, controller);
    this.activeTurn = operation;
    try {
      return await operation;
    } finally {
      if (this.activeTurn === operation) this.activeTurn = undefined;
      if (this.activeController === controller) this.activeController = undefined;
    }
  }

  async cancel(): Promise<boolean> {
    const controller = this.activeController;
    const turn = this.activeTurn;
    if (!controller || !turn) return false;
    controller.abort();
    this.cancelPendingInteractions("Turn cancelled.");
    await turn.catch(() => undefined);
    return true;
  }

  respondPermission(id: string, outcome: RuntimePermissionOutcome): boolean {
    const pending = this.pendingPermissions.get(id);
    if (!pending) return false;
    this.pendingPermissions.delete(id);
    pending.resolve(outcome);
    this.emit({ type: "permission-outcome", requestId: id, outcome });
    return true;
  }

  respondQuestion(id: string, outcome: RuntimeQuestionOutcome): boolean {
    const pending = this.pendingQuestions.get(id);
    if (!pending) return false;
    this.pendingQuestions.delete(id);
    pending.resolve(outcome);
    this.emit({ type: "question-outcome", requestId: id, outcome });
    return true;
  }

  async close(): Promise<void> {
    return this.serializeStateTransition(async () => {
      if (this.lifecycle === "closed") return;
      this.lifecycle = "closing";
      this.mutationAdmissionOpen = false;
      this.activeController?.abort();
      this.cancelPendingInteractions("Session closed.");
      await this.activeTurn?.catch(() => undefined);

      const failures: Error[] = [];
      const attempt = async (id: string, action: () => Promise<void>): Promise<void> => {
        if (this.completedCleanup.has(id)) return;
        try {
          await action();
          this.completedCleanup.add(id);
        } catch (error) {
          const cause = error instanceof Error ? error : new Error(String(error));
          failures.push(new Error(`${id}: ${cause.message}`, { cause }));
        }
      };

      await attempt("history-flush", () => this.flushHistory());
      await attempt("execution-boundary", async () => {
        const result = await this.boundary.cleanup();
        if (!result.ok) throw new Error(result.reason ?? "Execution boundary cleanup failed.");
      });
      await attempt("turn-driver", async () => { await this.driver.closeSession?.(this.id); });
      await attempt("history", () => this.history.close());
      for (const resource of this.resources) {
        await attempt(`resource:${resource.id}`, async () => { await resource.close(); });
      }

      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          `Failed to close runtime session ${this.id}: ${failures.map((failure) => failure.message).join("; ")}`
        );
      }
      this.lifecycle = "closed";
      this.listeners.clear();
    });
  }

  private async runTurn(prompt: RuntimePrompt, controller: AbortController): Promise<RuntimeTurnResult> {
    await this.ensureHistoryLoaded();
    this.emit({ type: "turn-start", prompt });
    await this.appendHistory({ role: "user", content: prompt.text });
    try {
      const driverContext = {
        session: this.snapshot(),
        prompt,
        signal: controller.signal,
        emit: (event: RuntimeEvent) => this.captureEvent(event),
        requestPermission: (request: Omit<RuntimePermissionRequest, "id">) => this.requestPermission(request),
        requestQuestion: (request: Omit<RuntimeQuestionRequest, "id">) => this.requestQuestion(request),
      };
      const runDriver = () => this.driver.run(driverContext);
      const result = this.ambientExecutionContext
        ? await runWithExecutionContext({
        cwd: this.cwd,
        boundary: this.boundary,
        additionalRoots: this.additionalRoots,
        signal: controller.signal,
        capabilities: {
          backgroundProcesses: false,
          interactiveTerminal: false,
        },
        runtime: {
          sessionId: this.id,
          getMode: () => this.mode,
          setMode: (mode) => { this.setMode(mode); },
          canMutate: () => this.mutationAdmissionOpen && this.lifecycle === "open",
          getToolProvider: () => this.tools,
          getApprovalPolicy: () => this.effectiveConfig().approvalPolicy,
          getConfig: () => this.effectiveConfig(),
          requestPermission: async (input) => {
            const outcome = await this.requestPermission({
              toolCallId: input.tool?.callID ?? randomUUID(),
              title: input.message,
              kind: this.permissionKind(input.permission),
              options: [
                { id: "allow", label: "Allow once", kind: "allow-once" },
                { id: "reject", label: "Reject", kind: "reject-once" },
              ],
              ...(input.metadata ? { rawInput: input.metadata } : {}),
            });
            if (outcome.outcome === "cancelled") return "cancel";
            return outcome.optionId === "allow" ? "allow" : "reject";
          },
          requestQuestion: async (input) => {
            const outcome = await this.requestQuestion(input);
            return outcome.outcome === "answered" ? outcome.values : null;
          },
        },
      }, runDriver)
        : await runDriver();
      await this.flushHistory();
      const stopReason = controller.signal.aborted ? "cancelled" : result.stopReason;
      if (result.usage) this.emit({ type: "usage", usage: result.usage });
      if (stopReason === "cancelled") this.emit({ type: "turn-cancel" });
      this.emit({ type: "turn-end", stopReason });
      return { stopReason, ...(result.usage ? { usage: result.usage } : {}) };
    } catch (error) {
      if (controller.signal.aborted) {
        this.emit({ type: "turn-cancel" });
        this.emit({ type: "turn-end", stopReason: "cancelled" });
        return { stopReason: "cancelled" };
      }
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit({ type: "turn-error", error: err });
      throw err;
    }
  }

  private captureEvent(event: RuntimeEvent): void {
    if (event.type === "assistant-token") {
      this.appendOrExtendAssistant(event.text);
    }
    if (event.type === "plan" || event.type === "plan-update") {
      this.plan = {
        id: event.id,
        ...(event.type === "plan" && event.title ? { title: event.title } : {}),
        entries: event.entries.map((entry) => ({ ...entry })),
      };
    }
    this.emit(event);
  }

  private appendOrExtendAssistant(text: string): void {
    const last = this.historySnapshot.at(-1);
    if (last?.role === "assistant") {
      last.content += text;
    } else {
      this.historySnapshot.push({ role: "assistant", content: text });
    }
    this.queueHistoryAppend({ role: "assistant", content: text });
  }

  private async appendHistory(message: RuntimeHistoryMessage): Promise<void> {
    this.historySnapshot.push({ ...message });
    this.queueHistoryAppend(message);
    await this.flushHistory();
  }

  private async requestPermission(
    request: Omit<RuntimePermissionRequest, "id">
  ): Promise<RuntimePermissionOutcome> {
    if (this.activeController?.signal.aborted) return { outcome: "cancelled" };
    if (this.effectiveConfig().approvalPolicy === "allow-all") {
      const optionId = request.options.find((option) => option.kind.startsWith("allow"))?.id;
      const outcome: RuntimePermissionOutcome = optionId
        ? { outcome: "selected", optionId }
        : { outcome: "cancelled" };
      this.emit({ type: "permission-outcome", requestId: `bypass:${request.toolCallId}`, outcome });
      return outcome;
    }
    const id = randomUUID();
    const outcome = new Promise<RuntimePermissionOutcome>((resolve) => {
      this.pendingPermissions.set(id, { resolve });
    });
    this.emit({ type: "permission-request", request: { ...request, id } });
    return outcome;
  }

  private async requestQuestion(
    request: Omit<RuntimeQuestionRequest, "id">
  ): Promise<RuntimeQuestionOutcome> {
    if (this.activeController?.signal.aborted) {
      return { outcome: "cancelled", reason: "Turn cancelled." };
    }
    const id = randomUUID();
    const outcome = new Promise<RuntimeQuestionOutcome>((resolve) => {
      this.pendingQuestions.set(id, { resolve });
    });
    this.emit({ type: "question", request: { ...request, id } });
    return outcome;
  }

  private emit(event: RuntimeEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private permissionKind(permission: string): "read" | "edit" | "delete" | "execute" | "other" {
    if (permission === "read" || permission === "path_outside_cwd") return "read";
    if (permission === "edit" || permission === "write") return "edit";
    if (permission === "delete") return "delete";
    if (permission === "bash" || permission === "mcp") return "execute";
    return "other";
  }

  private ensureOpen(): void {
    if (this.lifecycle !== "open") {
      throw new Error(`Session ${this.id} is ${this.lifecycle}.`);
    }
  }

  private commitMode(mode: RuntimeMode): void {
    this.mode = mode;
    this.mutationAdmissionOpen = mode === "AGENT";
    this.emit({ type: "mode", mode });
  }

  private serializeStateTransition<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.stateTransition.then(action, action);
    this.stateTransition = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private effectiveConfig(): RuntimeConfig {
    return {
      ...this.config,
      ...(this.launchApprovalPolicy
        ? { approvalPolicy: this.launchApprovalPolicy }
        : {}),
    };
  }

  private ensureHistoryLoaded(): Promise<void> {
    if (!this.historyLoad) {
      this.historyLoad = this.history.load().then((messages) => {
        this.historySnapshot = [];
        for (const message of messages) {
          const previous = this.historySnapshot.at(-1);
          if (message.role === "assistant" && previous?.role === "assistant") {
            previous.content += message.content;
          } else {
            this.historySnapshot.push({ ...message });
          }
        }
      });
    }
    return this.historyLoad;
  }

  private queueHistoryAppend(message: RuntimeHistoryMessage): void {
    const copy = { ...message };
    this.historyWrites = this.historyWrites
      .then(() => this.history.append(copy))
      .catch((error) => {
        this.historyWriteError ??= error;
      });
  }

  private async flushHistory(): Promise<void> {
    await this.historyWrites;
    if (this.historyWriteError !== undefined) {
      throw this.historyWriteError;
    }
  }

  private cancelPendingInteractions(reason: string): void {
    for (const id of [...this.pendingPermissions.keys()]) {
      this.respondPermission(id, { outcome: "cancelled" });
    }
    for (const id of [...this.pendingQuestions.keys()]) {
      this.respondQuestion(id, { outcome: "cancelled", reason });
    }
  }
}

export class HeadlessRuntime {
  private readonly sessions = new Map<string, RuntimeSession>();
  private lifecycle: "open" | "disposing" | "disposed" = "open";
  private driverDisposed = false;
  private stateTransition: Promise<void> = Promise.resolve();

  constructor(private readonly options: HeadlessRuntimeOptions) {}

  createSession(input: RuntimeSessionInput): RuntimeSession {
    if (this.lifecycle !== "open") throw new Error(`Runtime is ${this.lifecycle}.`);
    const session = new RuntimeSession(
      this.options.turnDriver,
      input,
      this.options.launchApprovalPolicy
    );
    if (this.sessions.has(session.id)) throw new Error(`Session ${session.id} already exists.`);
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(id: string): RuntimeSession | undefined {
    return this.sessions.get(id);
  }

  async closeSession(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;
    await session.close();
    this.sessions.delete(id);
    return true;
  }

  async dispose(): Promise<void> {
    return this.serializeStateTransition(async () => {
      if (this.lifecycle === "disposed") return;
      this.lifecycle = "disposing";
      const failures: Error[] = [];
      await Promise.all([...this.sessions.entries()].map(async ([id, session]) => {
        try {
          await session.close();
          this.sessions.delete(id);
        } catch (error) {
          failures.push(error instanceof Error ? error : new Error(String(error)));
        }
      }));
      if (!this.driverDisposed) {
        try {
          await this.options.turnDriver.dispose?.();
          this.driverDisposed = true;
        } catch (error) {
          failures.push(error instanceof Error ? error : new Error(String(error)));
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          `Failed to dispose runtime: ${failures.map((failure) => failure.message).join("; ")}`
        );
      }
      this.lifecycle = "disposed";
    });
  }

  private serializeStateTransition<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.stateTransition.then(action, action);
    this.stateTransition = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
