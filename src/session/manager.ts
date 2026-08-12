import { Bus, SessionEvents } from "../bus";
import {
  SessionStoreInstance,
  Session,
  Message,
  SideExchange,
  getProjectID,
} from "./store";
import { CheckpointManager } from "./checkpoint";
import { CompactManager } from "./compact";
import type { OptionalPatch } from "../util/omit-undefined.js";
import { writeActiveSessionMarker } from "../util/active-session-marker.js";
import { DEFAULT_MODE, normalizeMode } from "../constants.js";
import type { StagedSessionCreation, StagedSessionSnapshot } from "./store.js";
import { Storage } from "../storage/index.js";
import { withSessionCommitLock } from "./commit-lock.js";
import { currentSessionManager } from "./runtime-context.js";

interface SessionManagerOptions {
  defaultModel?: string
  defaultMode?: string
  initialContextWindow?: number
  directory?: string
  writeActiveMarker?: boolean
}

export interface CurrentSessionMutationToken {
  readonly sessionID: string;
  readonly generation: number;
}

export interface CurrentSessionMutationContext {
  readonly token: CurrentSessionMutationToken;
  isCurrent(): boolean;
  update(
    updates: OptionalPatch<Omit<Session, "id" | "created_at" | "updated_at">>
  ): Promise<Session | null>;
}

export interface CurrentSessionMutationResult<T> {
  applied: boolean;
  value?: T;
}

export type SessionFlushResult =
  | { status: "persisted"; sessionID: string; generation: number }
  | { status: "dirty"; sessionID: string; generation: number; attempts: number }
  | { status: "stale"; sessionID: string; generation: number }
  | { status: "no-session" };

const MAX_STABLE_FLUSH_ATTEMPTS = 3;

function unstableFlushReason(result: Exclude<SessionFlushResult, { status: "persisted" }>): string {
  return result.status === "dirty"
    ? `remained dirty after ${result.attempts} attempts`
    : "became stale";
}

export class SessionManagerImpl {
  private static instance: SessionManagerImpl;
  private currentSession: Session | null = null;
  private currentGeneration = 0;
  private currentContentRevision = 0;
  private sessionHistory: Session[] = [];
  private sessionMutationChains = new Map<string, Promise<unknown>>();
  private pendingGenerationFences = new Map<string, number>();
  private options: Required<SessionManagerOptions> = {
    defaultModel: "",
    defaultMode: "ASK",
    initialContextWindow: 200000,
    // Empty means "follow process.cwd()" for the legacy TUI singleton. Headless
    // managers pass an explicit immutable session cwd.
    directory: "",
    writeActiveMarker: true,
  };

  private constructor() {
    Bus.subscribe((event) => {
      if (event.type !== SessionEvents.Updated.name) return;

      const payload = event.properties as {
        sessionID?: unknown;
        session?: unknown;
        sessionGeneration?: unknown;
      };
      if (payload.sessionID !== this.currentSession?.id) return;
      if (
        typeof payload.sessionGeneration === "number" &&
        payload.sessionGeneration !== this.currentGeneration
      ) return;

      const incoming = payload.session as Session;
      const current = this.currentSession;
      if (!current) {
        this.currentSession = incoming;
        return;
      }

      if (incoming === current) return;

      if (incoming.messages.length < current.messages.length) {
        this.currentSession = { ...incoming, messages: current.messages };
        this.currentContentRevision++;
        return;
      }

      this.currentSession = incoming;
      this.currentContentRevision++;
    });
  }

  static getInstance(): SessionManagerImpl {
    if (!SessionManagerImpl.instance) {
      SessionManagerImpl.instance = new SessionManagerImpl();
    }
    return SessionManagerImpl.instance;
  }

  static create(options: Partial<SessionManagerOptions> = {}): SessionManagerImpl {
    const manager = new SessionManagerImpl();
    manager.setOptions(options);
    return manager;
  }

  private markActive(sessionID: string): void {
    if (this.options.writeActiveMarker) writeActiveSessionMarker(sessionID);
  }

  setOptions(options: Partial<SessionManagerOptions>): void {
    this.options = {
      ...this.options,
      ...options as Required<SessionManagerOptions>,
      ...(options.defaultMode === undefined
        ? {}
        : { defaultMode: normalizeMode(options.defaultMode) }),
    };
  }

  getOptions(): Required<SessionManagerOptions> {
    return { ...this.options };
  }

  getCurrentSession(): Session | null {
    return this.currentSession;
  }

  getCurrentSessionID(): string | null {
    return this.currentSession?.id ?? null;
  }

  private generateSessionID(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async createNew(name?: string): Promise<Session> {
    const previousSession = this.currentSession;
    const previousGeneration = this.currentGeneration;
    const previousRevision = this.currentContentRevision;
    const historyLength = this.sessionHistory.length;
    const sessionID = this.generateSessionID();
    const sessionName = name ?? this.generateSessionName();
    const directory = this.options.directory || process.cwd();
    const projectID = getProjectID(directory);

    const session: Omit<Session, "created_at" | "updated_at"> = {
      id: sessionID,
      name: sessionName,
      projectID,
      directory,
      messages: [],
      mode: DEFAULT_MODE,
      model: this.options.defaultModel,
      todos: [],
      context_window: this.options.initialContextWindow,
      cost: 0,
      metadata: {},
    };

    let stage: StagedSessionCreation | undefined;
    let restoreSession = previousSession;
    let restoreRevision = previousRevision;
    try {
      stage = await SessionStoreInstance.stageCreate(session);
      await this.finalizeCurrentForReplacement();
      restoreSession = this.currentSession;
      restoreRevision = this.currentContentRevision;
      await stage.commit();
      await stage.activate();

      const newSession = stage.session;
      this.currentSession = newSession;
      this.currentGeneration = previousGeneration + 1;
      this.currentContentRevision = 0;
      this.sessionHistory.push(newSession);
      this.markActive(newSession.id);
      Bus.publish(SessionEvents.Created, { sessionID: newSession.id, session: newSession });
      return newSession;
    } catch (error) {
      if (previousSession && this.currentSession?.id === previousSession.id) {
        restoreSession = this.currentSession;
      }
      this.currentSession = restoreSession;
      this.currentGeneration = previousGeneration;
      this.currentContentRevision = restoreRevision;
      this.sessionHistory.length = historyLength;
      if (restoreSession) this.markActive(restoreSession.id);

      if (stage) {
        try {
          await stage.rollback();
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            `New session creation failed: ${(error as Error).message}; rollback failed: ${(rollbackError as Error).message}`
          );
        }
      }
      throw error;
    }
  }

  async load(sessionID: string): Promise<Session> {
    if (this.currentSession?.id === sessionID) {
      return this.reloadCurrentSession(sessionID);
    }

    const previousGeneration = this.currentGeneration;
    // Resolve the target before finalizing the current session so a missing
    // or unreadable target cannot partially apply a switch.
    let session = await SessionStoreInstance.read(sessionID);
    await this.finalizeCurrentForReplacement();

    const originalMode = session.mode;
    const previousSession = this.currentSession;
    const previousRevision = this.currentContentRevision;
    const historyLength = this.sessionHistory.length;
    let targetStage: StagedSessionSnapshot | undefined;

    try {
      const canonicalMode = normalizeMode(session.mode);
      if (session.mode !== canonicalMode) {
        session = {
          ...session,
          mode: canonicalMode,
          updated_at: new Date().toISOString(),
        };
        targetStage = await SessionStoreInstance.stageSnapshot(session);
      }

      await targetStage?.commit();
      targetStage = undefined;
      this.currentSession = session;
      this.currentGeneration = previousGeneration + 1;
      this.currentContentRevision = 0;
      this.sessionHistory.push(session);
      this.markActive(session.id);

      try {
        if (session.mode !== originalMode) {
          Bus.publish(SessionEvents.Updated, { sessionID, session });
        }
        Bus.publish(SessionEvents.Status, {
          sessionID,
          status: "idle",
        });
      } catch {
        // Observer failures cannot invalidate an already committed replacement.
      }

      return session;
    } catch (error) {
      this.currentSession = previousSession;
      this.currentGeneration = previousGeneration;
      this.currentContentRevision = previousRevision;
      this.sessionHistory.length = historyLength;
      if (previousSession) this.markActive(previousSession.id);
      if (targetStage) {
        try {
          await targetStage.rollback();
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            `Session replacement failed: ${(error as Error).message}; rollback failed: ${(rollbackError as Error).message}`
          );
        }
      }
      throw error;
    }
  }

  /**
   * Replace the current session with a fresh generation of the same identity.
   *
   * Lock order is always the session mutation chain followed by the atomic
   * file-promotion chain. The generation fence is installed synchronously
   * before joining the session chain, so prior work either fails its promotion
   * predicate or completes before this replacement snapshot is promoted.
   */
  private async reloadCurrentSession(sessionID: string): Promise<Session> {
    const previousSession = this.currentSession;
    if (!previousSession || previousSession.id !== sessionID) {
      return this.load(sessionID);
    }

    const replacement = structuredClone(previousSession);
    const previousRevision = this.currentContentRevision;
    const originalMode = replacement.mode;
    const historyLength = this.sessionHistory.length;
    this.beginGenerationFence(sessionID);

    const run = this.serializeSessionMutation(sessionID, async () => {
      let targetStage: StagedSessionSnapshot | undefined;
      let todoStage: Awaited<ReturnType<typeof Storage.stage>> | undefined;
      try {
        const canonicalMode = normalizeMode(replacement.mode);
        const session: Session = {
          ...replacement,
          mode: canonicalMode,
          updated_at: new Date().toISOString(),
        };

        // Lock ordering: session mutation queue -> independent file staging ->
        // session commit lease -> rename/fsync. No path acquires these in the
        // reverse order.
        todoStage = await Storage.stage(["todo", sessionID], session.todos);
        targetStage = await SessionStoreInstance.stageSnapshot(session);
        let replacementGeneration = this.currentGeneration;
        await withSessionCommitLock(sessionID, async (lease) => {
          if (this.currentSession?.id !== sessionID) {
            throw new Error("Same-session replacement identity changed");
          }
          if (this.currentContentRevision !== previousRevision) {
            throw new Error("Same-session replacement content changed during activation");
          }

          // Promote replacement bytes while the old generation is still
          // visible. Only after rename + directory fsync complete does the
          // in-memory generation advance under this same lease.
          await todoStage!.commit();
          todoStage = undefined;
          await targetStage!.commitWithLease(lease);
          targetStage = undefined;
          replacementGeneration = this.currentGeneration + 1;
          this.currentSession = session;
          this.currentGeneration = replacementGeneration;
          this.currentContentRevision = 0;
        });

        this.sessionHistory.push(session);
        this.markActive(session.id);

        try {
          if (session.mode !== originalMode) {
            Bus.publish(SessionEvents.Updated, {
              sessionID,
              session,
              sessionGeneration: replacementGeneration,
            });
          }
          Bus.publish(SessionEvents.Status, { sessionID, status: "idle" });
        } catch {
          // Observer failures cannot invalidate an already committed replacement.
        }

        return session;
      } catch (error) {
        this.currentSession = previousSession;
        this.sessionHistory.length = historyLength;
        this.markActive(previousSession.id);
        const rollbackFailures: unknown[] = [];
        if (targetStage) {
          try {
            await targetStage.rollback();
          } catch (rollbackError) {
            rollbackFailures.push(rollbackError);
          }
        }
        if (todoStage) {
          try {
            await todoStage.rollback();
          } catch (rollbackError) {
            rollbackFailures.push(rollbackError);
          }
        }
        if (rollbackFailures.length > 0) {
          throw new AggregateError(
            [error, ...rollbackFailures],
            `Same-session replacement failed: ${(error as Error).message}; rollback failed: ${rollbackFailures.map((failure) => (failure as Error).message).join("; ")}`
          );
        }
        throw error;
      }
    });
    return run.finally(() => this.endGenerationFence(sessionID));
  }

  /** Persist/finalize the old session while retaining it as current until activation. */
  private async finalizeCurrentForReplacement(): Promise<void> {
    if (!this.currentSession) return;
    const sessionID = this.currentSession.id;
    const generation = this.currentGeneration;
    await CheckpointManager.cleanupCheckpoints(sessionID);
    const flush = await this.flushCurrent();
    if (
      flush.status !== "persisted" ||
      flush.sessionID !== sessionID ||
      flush.generation !== generation
    ) {
      const reason = flush.status === "persisted"
        ? "target identity changed"
        : unstableFlushReason(flush);
      throw new Error(`Session replacement aborted: current session flush ${reason}`);
    }
  }

  /** Inspect a canonicalized resume target without changing it or the active session. */
  async inspectForResume(sessionID: string): Promise<Session> {
    const session = await SessionStoreInstance.read(sessionID);
    const canonicalMode = normalizeMode(session.mode);
    return session.mode === canonicalMode
      ? session
      : { ...session, mode: canonicalMode };
  }

  async switchTo(sessionID: string): Promise<Session> {
    if (this.currentSession?.id === sessionID) {
      return this.currentSession;
    }

    return await this.load(sessionID);
  }

  private async serializeSessionMutation<T>(
    sessionID: string,
    mutation: () => Promise<T>
  ): Promise<T> {
    const previous = this.sessionMutationChains.get(sessionID) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(mutation);
    this.sessionMutationChains.set(sessionID, run);
    try {
      return await run;
    } finally {
      if (this.sessionMutationChains.get(sessionID) === run) {
        this.sessionMutationChains.delete(sessionID);
      }
    }
  }

  private mutationGuard(sessionID: string, generation: number) {
    return {
      sessionGeneration: generation,
      canCommit: () =>
        this.currentSession?.id !== sessionID ||
        (this.currentGeneration === generation &&
          !this.hasPendingGenerationFence(sessionID)),
    };
  }

  private beginGenerationFence(sessionID: string): void {
    this.pendingGenerationFences.set(
      sessionID,
      (this.pendingGenerationFences.get(sessionID) ?? 0) + 1
    );
  }

  private endGenerationFence(sessionID: string): void {
    const remaining = (this.pendingGenerationFences.get(sessionID) ?? 1) - 1;
    if (remaining <= 0) this.pendingGenerationFences.delete(sessionID);
    else this.pendingGenerationFences.set(sessionID, remaining);
  }

  private hasPendingGenerationFence(sessionID: string): boolean {
    return (this.pendingGenerationFences.get(sessionID) ?? 0) > 0;
  }

  private markCurrentContentMutation(sessionID: string, generation: number): void {
    if (
      this.currentSession?.id === sessionID &&
      this.currentGeneration === generation
    ) {
      this.currentContentRevision++;
    }
  }

  /** Capture current session identity before a session-scoped mutation awaits. */
  captureCurrentSessionMutation(
    expectedSessionID: string = this.currentSession?.id ?? ""
  ): CurrentSessionMutationToken | null {
    if (!this.currentSession || this.currentSession.id !== expectedSessionID) return null;
    return {
      sessionID: this.currentSession.id,
      generation: this.currentGeneration,
    };
  }

  isCurrentSessionMutation(token: CurrentSessionMutationToken): boolean {
    return this.currentSession?.id === token.sessionID &&
      this.currentGeneration === token.generation &&
      !this.hasPendingGenerationFence(token.sessionID);
  }

  /**
   * Serialize a mutation against the captured session generation. A replacement
   * invalidates queued work before its callback can persist or publish.
   */
  async runCurrentSessionMutation<T>(
    token: CurrentSessionMutationToken,
    mutation: (context: CurrentSessionMutationContext) => Promise<T>
  ): Promise<CurrentSessionMutationResult<T>> {
    return this.serializeSessionMutation(token.sessionID, async () => {
      const isCurrent = () => this.isCurrentSessionMutation(token);
      if (!isCurrent()) return { applied: false };

      const context: CurrentSessionMutationContext = {
        token,
        isCurrent,
        update: async (updates) => {
          if (!isCurrent()) return null;
          const updated = await SessionStoreInstance.update(token.sessionID, updates, {
            sessionGeneration: token.generation,
            canCommit: isCurrent,
          });
          if (!isCurrent()) return null;
          if (this.currentSession !== updated) {
            this.currentSession = updated;
            this.markCurrentContentMutation(token.sessionID, token.generation);
          }
          return updated;
        },
      };
      const value = await mutation(context);
      if (!isCurrent()) return { applied: false };
      return { applied: true, value };
    });
  }

  async update(
    updates: OptionalPatch<Omit<Session, "id" | "created_at" | "updated_at">>
  ): Promise<Session> {
    if (!this.currentSession) {
      throw new Error("No active session to update");
    }

    const sessionID = this.currentSession.id;
    const generation = this.currentGeneration;
    const updated = await this.serializeSessionMutation(
      sessionID,
      () => SessionStoreInstance.update(
        sessionID,
        updates,
        this.mutationGuard(sessionID, generation)
      )
    );
    if (
      this.currentSession?.id === sessionID &&
      this.currentGeneration === generation &&
      !this.hasPendingGenerationFence(sessionID)
    ) {
      if (this.currentSession !== updated) {
        this.currentSession = updated;
        this.markCurrentContentMutation(sessionID, generation);
      }
    }

    return updated;
  }

  async setHeaderTitle(title: string): Promise<void> {
    if (!this.currentSession) return;
    await this.update({ headerTitle: title });
  }

  async appendSideExchange(exchange: SideExchange): Promise<void> {
    if (!this.currentSession) {
      throw new Error("No active session to append side exchange to");
    }

    const sessionID = this.currentSession.id;
    const generation = this.currentGeneration;
    const sideExchanges = [...(this.currentSession.sideExchanges ?? []), exchange];
    this.currentSession.sideExchanges = sideExchanges;
    this.markCurrentContentMutation(sessionID, generation);
    SessionStoreInstance.autoSave(
      sessionID,
      { sideExchanges },
      this.mutationGuard(sessionID, generation)
    );
  }

  async markSideExchangeCopied(exchangeId: string): Promise<void> {
    if (!this.currentSession) return;

    const sessionID = this.currentSession.id;
    const generation = this.currentGeneration;
    const sideExchanges = (this.currentSession.sideExchanges ?? []).map((ex) =>
      ex.id === exchangeId ? { ...ex, copiedToMain: true } : ex
    );
    this.currentSession.sideExchanges = sideExchanges;
    this.markCurrentContentMutation(sessionID, generation);
    SessionStoreInstance.autoSave(
      sessionID,
      { sideExchanges },
      this.mutationGuard(sessionID, generation)
    );
  }

  async addMessage(message: Message): Promise<void> {
    if (!this.currentSession) {
      throw new Error("No active session to add message to");
    }

    const sessionID = this.currentSession.id;
    const generation = this.currentGeneration;
    const messages = [...this.currentSession.messages, message];
    this.currentSession.messages = messages;
    this.markCurrentContentMutation(sessionID, generation);

    // Use debounced auto-save instead of immediate write — saves are
    // consolidated per-turn so the session on disk always reflects a
    // complete conversation state rather than mid-turn snapshots.
    SessionStoreInstance.autoSave(
      sessionID,
      { messages },
      this.mutationGuard(sessionID, generation)
    );
    CompactManager.invalidateCache(sessionID);

    await CompactManager.maybeCompact(sessionID);
  }

  /** Git checkpoint at current message index (explicit /checkpoint or experimental undo). */
  async createCheckpoint(summary?: string): Promise<boolean> {
    if (!this.currentSession) {
      return false;
    }

    const messageIndex = this.currentSession.messages.length - 1;
    if (messageIndex < 0) {
      return false;
    }

    return await CheckpointManager.createCheckpoint(
      this.currentSession.id,
      messageIndex,
      summary
    );
  }

  async flushCurrent(): Promise<SessionFlushResult> {
    const token = this.captureCurrentSessionMutation();
    if (!token) return { status: "no-session" };

    for (let attempt = 1; attempt <= MAX_STABLE_FLUSH_ATTEMPTS; attempt++) {
      const result = await this.runCurrentSessionMutation(token, async (mutation) => {
        await SessionStoreInstance.flushSave(token.sessionID);
        if (!mutation.isCurrent()) return "stale" as const;

        const current = this.currentSession;
        if (!current || current.id !== token.sessionID) return "stale" as const;
        const snapshotRevision = this.currentContentRevision;
        const snap = { ...current, updated_at: new Date().toISOString() };
        const promoted = await SessionStoreInstance.writeSnapshot(snap, {
          sessionGeneration: token.generation,
          canCommit: mutation.isCurrent,
        });
        if (!promoted || !mutation.isCurrent()) return "stale" as const;
        if (this.currentContentRevision !== snapshotRevision) return "dirty" as const;

        const latest = this.currentSession;
        if (!latest || latest.id !== token.sessionID) return "stale" as const;
        this.currentSession = { ...latest, updated_at: snap.updated_at };
        this.markActive(snap.id);
        return "persisted" as const;
      });

      if (!result.applied || result.value === "stale") {
        return {
          status: "stale",
          sessionID: token.sessionID,
          generation: token.generation,
        };
      }
      if (result.value === "persisted") {
        return {
          status: "persisted",
          sessionID: token.sessionID,
          generation: token.generation,
        };
      }
    }

    return {
      status: "dirty",
      sessionID: token.sessionID,
      generation: token.generation,
      attempts: MAX_STABLE_FLUSH_ATTEMPTS,
    };
  }

  async save(name?: string): Promise<Session> {
    if (!this.currentSession) {
      throw new Error("No active session to save");
    }

    const token = this.captureCurrentSessionMutation()!;
    const flush = await this.flushCurrent();
    if (
      flush.status !== "persisted" ||
      flush.sessionID !== token.sessionID ||
      flush.generation !== token.generation
    ) {
      const reason = flush.status === "persisted"
        ? "target identity changed"
        : unstableFlushReason(flush);
      throw new Error(`Session save aborted: current session flush ${reason}`);
    }

    if (name) {
      await this.update({ name });
    }

    return this.currentSession;
  }

  async exitCurrent(): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    const sessionID = this.currentSession.id;

    try {
      await CheckpointManager.cleanupCheckpoints(sessionID);
    } catch (e) {
      console.error("Failed to cleanup checkpoints:", e);
    }

    const generation = this.currentGeneration;
    const flush = await this.flushCurrent();
    if (
      flush.status !== "persisted" ||
      flush.sessionID !== sessionID ||
      flush.generation !== generation
    ) {
      const reason = flush.status === "persisted"
        ? "target identity changed"
        : unstableFlushReason(flush);
      throw new Error(`Session exit aborted: current session flush ${reason}`);
    }

    this.currentSession = null;
    this.currentGeneration++;
    this.currentContentRevision = 0;
  }

  async exit(): Promise<{ session: Session | null; summary: string }> {
    const session = this.currentSession;

    if (!session) {
      return { session: null, summary: "No active session" };
    }

    await this.exitCurrent();

    const summary = this.generateSessionSummary(session);

    return { session, summary };
  }

  async listSessions(): Promise<Session[]> {
    const directory = this.options.directory || process.cwd();
    return await SessionStoreInstance.listByProject(getProjectID(directory));
  }

  async deleteSession(sessionID: string): Promise<boolean> {
    if (this.currentSession?.id === sessionID) {
      await this.exitCurrent();
    }

    try {
      await SessionStoreInstance.delete(sessionID);
      await CheckpointManager.cleanupCheckpoints(sessionID);
      return true;
    } catch (e) {
      console.error(`Failed to delete session ${sessionID}:`, e);
      return false;
    }
  }

  private generateSessionName(): string {
    const date = new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `Session ${date}`;
  }

  private generateSessionSummary(session: Session): string {
    const messageCount = session.messages.length;
    const completedTodos = session.todos.filter((t) => t.status === "completed").length;
    const duration = this.calculateDuration(session);

    return [
      `Session: ${session.name}`,
      `Duration: ${duration}`,
      `Messages: ${messageCount}`,
      `Todos: ${completedTodos}/${session.todos.length} completed`,
      `Cost: $${session.cost.toFixed(2)}`,
    ].join("\n");
  }

  private calculateDuration(session: Session): string {
    const created = new Date(session.created_at);
    const updated = new Date(session.updated_at);
    const diffMs = updated.getTime() - created.getTime();

    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffHours > 0) {
      return `${diffHours}h ${diffMins % 60}m`;
    }
    return `${diffMins}m`;
  }
}

const defaultSessionManager = SessionManagerImpl.getInstance();

/** TUI callers use the default manager; headless turns use their async binding. */
export const SessionManager: SessionManagerImpl = new Proxy(defaultSessionManager, {
  get(target, property) {
    const manager = currentSessionManager() ?? target;
    const value = Reflect.get(manager, property, manager);
    return typeof value === "function" ? value.bind(manager) : value;
  },
});
