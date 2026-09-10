import { Bus, SessionEvents } from "../bus";
import {
  SessionStoreInstance,
  Session,
  Message,
  SideExchange,
  getCurrentProjectID,
} from "./store";
import { CheckpointManager } from "./checkpoint";
import { CompactManager } from "./compact";
import type { OptionalPatch } from "../util/omit-undefined.js";
import { writeActiveSessionMarker } from "../util/active-session-marker.js";
import { applyTitlePolicy, normalizeTitle, sameTitleBase } from "../util/title-policy.js";
import type { TitleMeta } from "./title-decision.js";

export interface SetHeaderTitleResult {
  /** The title actually stored (disambiguated when it collided). */
  title: string;
  /** True when the policy rejected the candidate. */
  rejected: boolean;
  /** Why it was rejected, for the tool-facing error message. */
  reason?: string;
  /** True when a collision forced a discriminator suffix. */
  disambiguated: boolean;
  /** True when the stored title did not change. */
  unchanged: boolean;
}

interface SessionManagerOptions {
  defaultModel?: string
  defaultMode?: string
  initialContextWindow?: number
}

class SessionManagerImpl {
  private static instance: SessionManagerImpl;
  private currentSession: Session | null = null;
  private sessionHistory: Session[] = [];
  private options: Required<SessionManagerOptions> = {
    defaultModel: "",
    defaultMode: "AGENT",
    initialContextWindow: 200000,
  };

  private constructor() {
    Bus.subscribe((event) => {
      if (event.type !== SessionEvents.Updated.name) return;

      const payload = event.properties as { sessionID?: unknown; session?: unknown };
      if (payload.sessionID !== this.currentSession?.id) return;

      const incoming = payload.session as Session;
      const current = this.currentSession;
      if (!current) {
        this.currentSession = incoming;
        return;
      }

      if (incoming.messages.length < current.messages.length) {
        this.currentSession = { ...incoming, messages: current.messages };
        return;
      }

      this.currentSession = incoming;
    });
  }

  static getInstance(): SessionManagerImpl {
    if (!SessionManagerImpl.instance) {
      SessionManagerImpl.instance = new SessionManagerImpl();
    }
    return SessionManagerImpl.instance;
  }

  setOptions(options: Partial<SessionManagerOptions>): void {
    this.options = { ...this.options, ...options as Required<SessionManagerOptions> };
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
    await this.exitCurrent();

    const sessionID = this.generateSessionID();
    const sessionName = name ?? this.generateSessionName();
    const directory = process.cwd();
    const projectID = getCurrentProjectID();

    const session: Omit<Session, "created_at" | "updated_at"> = {
      id: sessionID,
      name: sessionName,
      projectID,
      directory,
      messages: [],
      mode: this.options.defaultMode,
      model: this.options.defaultModel,
      todos: [],
      context_window: this.options.initialContextWindow,
      cost: 0,
      metadata: {},
    };

    const newSession = await SessionStoreInstance.create(session);
    this.currentSession = newSession;
    this.sessionHistory.push(newSession);
    writeActiveSessionMarker(newSession.id);

    return newSession;
  }

  async load(sessionID: string): Promise<Session> {
    const session = await SessionStoreInstance.read(sessionID);
    if (this.currentSession?.id === sessionID) {
      await this.flushCurrent();
    } else {
      await this.exitCurrent();
    }

    this.currentSession = session;
    this.sessionHistory.push(session);
    writeActiveSessionMarker(session.id);

    Bus.publish(SessionEvents.Status, {
      sessionID,
      status: "idle",
    });

    return session;
  }

  async switchTo(sessionID: string): Promise<Session> {
    if (this.currentSession?.id === sessionID) {
      return this.currentSession;
    }

    return await this.load(sessionID);
  }

  async update(
    updates: OptionalPatch<Omit<Session, "id" | "created_at" | "updated_at">>
  ): Promise<Session> {
    if (!this.currentSession) {
      throw new Error("No active session to update");
    }

    const updated = await SessionStoreInstance.update(this.currentSession.id, updates);
    this.currentSession = updated;

    return updated;
  }

  /**
   * Compute the stored title while guaranteeing:
   *  - the shared length / specificity policy is enforced (#139), and
   *  - no two sessions in the same project share an identical title.
   *
   * Reads sibling sessions from the store, so a rejected result costs one list.
   */
  async resolveHeaderTitle(title: string): Promise<SetHeaderTitleResult> {
    const normalized = normalizeTitle(title);
    const current = this.currentSession?.headerTitle;

    // Preserve the same-title no-op before policy checks: a session whose title
    // was set before this policy existed must still be able to repeat it, and a
    // title stored with a discriminator ("X (2)") is still "X" to its setter.
    if (current && sameTitleBase(current, normalized)) {
      return {
        title: current,
        rejected: false,
        disambiguated: false,
        unchanged: true,
      };
    }

    const taken = await this.siblingTitles();
    const policy = applyTitlePolicy(normalized, taken);
    if (!policy.ok || !policy.title) {
      return {
        title: normalized,
        rejected: true,
        ...(policy.reason ? { reason: policy.reason } : {}),
        disambiguated: false,
        unchanged: false,
      };
    }

    return {
      title: policy.title,
      rejected: false,
      disambiguated: policy.title.toLowerCase() !== normalized.toLowerCase(),
      unchanged: false,
    };
  }

  /**
   * Titles already used by other sessions in this project. Titles currently
   * in use are what matter for `/resume` readability.
   */
  async siblingTitles(): Promise<string[]> {
    if (!this.currentSession) return [];
    try {
      const sessions = await SessionStoreInstance.listByProject(
        this.currentSession.projectID
      );
      return sessions
        .filter((s) => s.id !== this.currentSession!.id)
        .map((s) => s.headerTitle ?? "")
        .filter((t) => t.trim().length > 0);
    } catch {
      // A listing failure must not block titling.
      return [];
    }
  }

  /**
   * Store a header title. Returns the enforcement result instead of throwing so
   * the silent automatic path can skip and the tool can surface the reason.
   *
   * @param source "manual" for set_header (never auto-replaced), "auto" for the
   *               generator.
   * @param meta   Retitle bookkeeping to persist with the new title.
   */
  async setHeaderTitle(
    title: string,
    opts?: { source?: "auto" | "manual"; meta?: TitleMeta }
  ): Promise<SetHeaderTitleResult> {
    if (!this.currentSession) {
      return {
        title,
        rejected: true,
        reason: "No active session",
        disambiguated: false,
        unchanged: false,
      };
    }

    const resolved = await this.resolveHeaderTitle(title);
    if (resolved.rejected || resolved.unchanged) return resolved;

    const source = opts?.source ?? "manual";
    const meta: TitleMeta =
      source === "manual"
        ? { source: "manual" }
        : { source: "auto", ...opts?.meta };

    await this.update({ headerTitle: resolved.title, titleMeta: meta });

    return resolved;
  }

  async appendSideExchange(exchange: SideExchange): Promise<void> {
    if (!this.currentSession) {
      throw new Error("No active session to append side exchange to");
    }

    const sideExchanges = [...(this.currentSession.sideExchanges ?? []), exchange];
    this.currentSession.sideExchanges = sideExchanges;
    SessionStoreInstance.autoSave(this.currentSession.id, { sideExchanges });
  }

  async markSideExchangeCopied(exchangeId: string): Promise<void> {
    if (!this.currentSession) return;

    const sideExchanges = (this.currentSession.sideExchanges ?? []).map((ex) =>
      ex.id === exchangeId ? { ...ex, copiedToMain: true } : ex
    );
    this.currentSession.sideExchanges = sideExchanges;
    SessionStoreInstance.autoSave(this.currentSession.id, { sideExchanges });
  }

  async addMessage(message: Message): Promise<void> {
    if (!this.currentSession) {
      throw new Error("No active session to add message to");
    }

    const messages = [...this.currentSession.messages, message];
    this.currentSession.messages = messages;

    // Use debounced auto-save instead of immediate write — saves are
    // consolidated per-turn so the session on disk always reflects a
    // complete conversation state rather than mid-turn snapshots.
    SessionStoreInstance.autoSave(this.currentSession.id, { messages });
    CompactManager.invalidateCache(this.currentSession.id);

    await CompactManager.maybeCompact(this.currentSession.id);
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

  async flushCurrent(): Promise<void> {
    if (!this.currentSession) return;
    await SessionStoreInstance.flushSave(this.currentSession.id);
    const snap = { ...this.currentSession, updated_at: new Date().toISOString() };
    await SessionStoreInstance.writeSnapshot(snap);
    this.currentSession = snap;
    writeActiveSessionMarker(snap.id);
  }

  async save(name?: string): Promise<Session> {
    if (!this.currentSession) {
      throw new Error("No active session to save");
    }

    await this.flushCurrent();

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

    await this.flushCurrent();

    try {
      await CheckpointManager.cleanupCheckpoints(sessionID);
    } catch (e) {
      console.error("Failed to cleanup checkpoints:", e);
    }

    this.currentSession = null;
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
    return await SessionStoreInstance.list();
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

export const SessionManager = SessionManagerImpl.getInstance();
