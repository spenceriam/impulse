import { Storage } from "../storage";
import { Bus, SessionEvents } from "../bus";
import crypto from "crypto";

/**
 * Generate a project ID from a directory path.
 * Uses SHA-1 hash of the absolute path (same approach as OpenCode).
 */
export function getProjectID(directory: string): string {
  return crypto.createHash("sha1").update(directory).digest("hex");
}

/**
 * Get the current project ID based on process.cwd()
 */
export function getCurrentProjectID(): string {
  return getProjectID(process.cwd());
}

export interface Session {
  id: string
  name: string
  projectID: string  // Hash of the working directory
  directory: string  // Human-readable directory path
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
  content_blocks?: MessageContentBlock[]
  validation?: MessageValidation
  timestamp: string
  tool_calls?: ToolCall[]
  mode?: string       // Mode used when generating (for assistant messages)
  model?: string      // Model used (e.g., "glm-4.7")
}

export type MessageContentBlock =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "thinking"; thinking: string }
  | { id: string; type: "tool_call"; tool_call_id: string };

export interface MessageValidation {
  findings: string[]
  nextSteps: string[]
}

export interface ToolCall {
  id?: string
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
  
  // Cache projectID -> sessionID mapping for quick lookups
  private sessionProjectMap: Map<string, string> = new Map();

  private constructor() {}

  static getInstance(): SessionStoreImpl {
    if (!SessionStoreImpl.instance) {
      SessionStoreImpl.instance = new SessionStoreImpl();
    }
    return SessionStoreImpl.instance;
  }

  /**
   * Get storage key for a session.
   * Structure: ["session", projectID, sessionID]
   * This organizes sessions by project folder.
   */
  private getKey(sessionID: string, projectID?: string): string[] {
    // If projectID provided, use it; otherwise look up from cache
    const pid = projectID ?? this.sessionProjectMap.get(sessionID) ?? getCurrentProjectID();
    return ["session", pid, sessionID];
  }

  async create(session: Omit<Session, "created_at" | "updated_at">): Promise<Session> {
    const now = new Date().toISOString();
    const newSession: Session = {
      ...session,
      created_at: now,
      updated_at: now,
    };

    // Cache the mapping
    this.sessionProjectMap.set(session.id, session.projectID);

    await Storage.write(this.getKey(session.id, session.projectID), newSession);
    Bus.publish(SessionEvents.Created, { sessionID: session.id, session: newSession });

    return newSession;
  }

  async read(sessionID: string, projectID?: string): Promise<Session> {
    const session = await Storage.read<Session>(this.getKey(sessionID, projectID));
    // Cache the mapping for future use
    this.sessionProjectMap.set(sessionID, session.projectID);
    return session;
  }

  async update(sessionID: string, updates: Partial<Session>): Promise<Session> {
    const projectID = this.sessionProjectMap.get(sessionID);
    const updated = await Storage.update<Session>(this.getKey(sessionID, projectID), (draft) => {
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

  /**
   * List sessions for the current project only.
   * Sessions are scoped to the working directory.
   */
  async list(): Promise<Session[]> {
    const projectID = getCurrentProjectID();
    return this.listByProject(projectID);
  }

  /**
   * List sessions for a specific project.
   */
  async listByProject(projectID: string): Promise<Session[]> {
    const keys = await Storage.list(["session", projectID]);
    const sessions: Session[] = [];

    for (const key of keys) {
      // key is ["session", projectID, sessionID] - we need the third element
      const sessionID = key[2];
      if (!sessionID) continue;
      try {
        const session = await this.read(sessionID, projectID);
        sessions.push(session);
      } catch (e) {
        console.warn(`Failed to read session ${sessionID}:`, e);
      }
    }

    return sessions.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  /**
   * List ALL sessions across all projects (for admin/debugging).
   */
  async listAll(): Promise<Session[]> {
    const keys = await Storage.list(["session"]);
    const sessions: Session[] = [];

    for (const key of keys) {
      // key is ["session", projectID, sessionID]
      const projectID = key[1];
      const sessionID = key[2];
      if (!projectID || !sessionID) continue;
      try {
        const session = await this.read(sessionID, projectID);
        sessions.push(session);
      } catch (e) {
        console.warn(`Failed to read session ${sessionID}:`, e);
      }
    }

    return sessions.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async delete(sessionID: string): Promise<void> {
    const projectID = this.sessionProjectMap.get(sessionID);
    await Storage.remove(this.getKey(sessionID, projectID));
    this.sessionProjectMap.delete(sessionID);
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
