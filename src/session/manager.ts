import { Bus, SessionEvents } from "../bus";
import { SessionStoreInstance, Session, Message, getCurrentProjectID } from "./store";
import { CheckpointManager } from "./checkpoint";
import { CompactManager } from "./compact";

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
    defaultModel: "glm-4.7",
    defaultMode: "AUTO",
    initialContextWindow: 200000,
  };

  private constructor() {}

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

    return newSession;
  }

  async load(sessionID: string): Promise<Session> {
    const session = await SessionStoreInstance.read(sessionID);
    await this.exitCurrent();

    this.currentSession = session;
    this.sessionHistory.push(session);

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

  async update(updates: Partial<Omit<Session, "id" | "created_at" | "updated_at">>): Promise<Session> {
    if (!this.currentSession) {
      throw new Error("No active session to update");
    }

    const updated = await SessionStoreInstance.update(this.currentSession.id, updates);
    this.currentSession = updated;

    return updated;
  }

  async addMessage(message: Message): Promise<void> {
    if (!this.currentSession) {
      throw new Error("No active session to add message to");
    }

    const messages = [...this.currentSession.messages, message];
    await this.update({ messages });

    const messageIndex = messages.length - 1;
    const summary = message.role === "user" ? message.content.slice(0, 100) : undefined;

    await CheckpointManager.createCheckpoint(
      this.currentSession.id,
      messageIndex,
      summary
    );

    await CompactManager.maybeCompact(this.currentSession.id);
  }

  async save(name?: string): Promise<Session> {
    if (!this.currentSession) {
      throw new Error("No active session to save");
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
