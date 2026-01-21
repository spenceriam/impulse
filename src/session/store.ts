import { Storage } from "../storage";
import { Bus, SessionEvents } from "../bus";

export interface Session {
  id: string
  name: string
  created_at: string
  updated_at: string
  messages: Message[]
  mode: string
  model: string
  todos: Todo[]
  context_window: number
  cost: number
  headerTitle?: string  // AI-generated session header title
  metadata?: Record<string, unknown>
}

export interface Message {
  role: "user" | "assistant" | "system"
  content: string
  reasoning_content?: string
  timestamp: string
  tool_calls?: ToolCall[]
}

export interface ToolCall {
  tool: string
  arguments: Record<string, unknown>
  result?: ToolResult
  timestamp: string
}

export interface ToolResult {
  success: boolean
  output?: string
  error?: string
  metadata?: Record<string, unknown>
}

export interface Todo {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority: "high" | "medium" | "low"
}

class SessionStoreImpl {
  private static instance: SessionStoreImpl;
  private saveTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private saveDelay: number = 1000;

  private constructor() {}

  static getInstance(): SessionStoreImpl {
    if (!SessionStoreImpl.instance) {
      SessionStoreImpl.instance = new SessionStoreImpl();
    }
    return SessionStoreImpl.instance;
  }

  private getKey(sessionID: string): string[] {
    return ["session", sessionID];
  }

  async create(session: Omit<Session, "created_at" | "updated_at">): Promise<Session> {
    const now = new Date().toISOString();
    const newSession: Session = {
      ...session,
      created_at: now,
      updated_at: now,
    };

    await Storage.write(this.getKey(session.id), newSession);
    Bus.publish(SessionEvents.Created, { sessionID: session.id, session: newSession });

    return newSession;
  }

  async read(sessionID: string): Promise<Session> {
    return await Storage.read<Session>(this.getKey(sessionID));
  }

  async update(sessionID: string, updates: Partial<Session>): Promise<Session> {
    const updated = await Storage.update<Session>(this.getKey(sessionID), (draft) => {
      Object.assign(draft, updates);
      draft.updated_at = new Date().toISOString();
    });

    Bus.publish(SessionEvents.Updated, { sessionID, session: updated });
    return updated;
  }

  autoSave(sessionID: string, updates: Partial<Session>): void {
    const existingTimeout = this.saveTimeouts.get(sessionID);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(async () => {
      try {
        await this.update(sessionID, updates);
      } catch (e) {
        console.error(`Failed to auto-save session ${sessionID}:`, e);
      } finally {
        this.saveTimeouts.delete(sessionID);
      }
    }, this.saveDelay);

    this.saveTimeouts.set(sessionID, timeout);
  }

  async list(): Promise<Session[]> {
    const keys = await Storage.list(["session"]);
    const sessions: Session[] = [];

    for (const key of keys) {
      const sessionID = key[0];
      if (!sessionID) continue;
      try {
        const session = await this.read(sessionID);
        sessions.push(session);
      } catch (e) {
        console.warn(`Failed to read session ${sessionID}:`, e);
      }
    }

    return sessions.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async delete(sessionID: string): Promise<void> {
    await Storage.remove(this.getKey(sessionID));
    Bus.publish(SessionEvents.Deleted, { sessionID });
  }

  cancelAutoSave(sessionID: string): void {
    const timeout = this.saveTimeouts.get(sessionID);
    if (timeout) {
      clearTimeout(timeout);
      this.saveTimeouts.delete(sessionID);
    }
  }

  setSaveDelay(delay: number): void {
    this.saveDelay = delay;
  }
}

export const SessionStoreInstance = SessionStoreImpl.getInstance();
