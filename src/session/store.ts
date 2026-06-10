import { Storage } from "../storage";
import { Bus, SessionEvents } from "../bus";
import { Global } from "../global";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import type { OptionalPatch } from "../util/omit-undefined.js";

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

/** Isolated side Q&A during a main turn; not included in main agent messages. */
export interface SideExchange {
  id: string
  createdAt: string
  userText: string
  assistantText: string
  /** Full thinking when the provider streamed reasoning. */
  thinkingText?: string
  /** Snapshot shown in overlay when -c was used. */
  contextSnapshot?: string
  usedContext: boolean
  copiedToMain?: boolean
}

export interface Session {
  id: string
  name: string
  projectID: string  // Hash of the working directory
  directory: string  // Human-readable directory path
  created_at: string
  updated_at: string
  messages: Message[]
  /** Side prompts for this session; excluded from main agent context. */
  sideExchanges?: SideExchange[]
  mode: string
  model: string
  todos: Todo[]
  context_window: number
  cost: number
  headerTitle?: string  // AI-generated session header title
  /** Per-session advisor toggle (restored on /resume). */
  advisorMode?: boolean
  /** Advisor model used when this session had advisor on. */
  advisorModel?: string
  /** Per-session vision toggle (restored on /resume). */
  visionMode?: boolean
  /** Vision model used when this session had vision on. */
  visionModel?: string
  metadata?: Record<string, unknown>
}

/** API payload for user messages (text or multimodal); persisted for session resume. */
export type UserMessageApiContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

export interface Message {
  role: "user" | "assistant" | "system" | "tool"
  content: string
  /** Required when role is "tool" — matches provider tool result messages. */
  tool_call_id?: string
  /** Expanded provider content when display differs (paste tokens, images). */
  apiContent?: UserMessageApiContent
  reasoning_content?: string
  /** Wall-clock ms for the reasoning phase on this assistant message (UI replay). */
  thinking_duration_ms?: number
  content_blocks?: MessageContentBlock[]
  validation?: MessageValidation
  timestamp: string
  tool_calls?: ToolCall[]
  mode?: string       // Mode used when generating (for assistant messages)
  model?: string      // Model used (e.g., "ollama/deepseek-v4-pro")
  /** Synthetic user note injected by impulse (steer, nudge, interrupt marker). */
  injected?: boolean
}

export type MessageContentBlock =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "thinking"; thinking: string; durationMs?: number }
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
  private pendingUpdates: Map<string, Partial<Session>> = new Map();
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

  private sessionFilePath(sessionID: string, projectID: string): string {
    return path.join(Global.Path.sessions, projectID, `${sessionID}.json`);
  }

  /** Write temp file then rename — avoids torn reads on crash mid-write. */
  private async atomicWriteSession(session: Session): Promise<void> {
    const target = this.sessionFilePath(session.id, session.projectID);
    const dir = path.dirname(target);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(session, null, 2), "utf-8");
    await fs.rename(tmp, target);
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

    await this.atomicWriteSession(newSession);
    Bus.publish(SessionEvents.Created, { sessionID: session.id, session: newSession });

    return newSession;
  }

  async read(sessionID: string, projectID?: string): Promise<Session> {
    const session = await Storage.read<Session>(this.getKey(sessionID, projectID));
    // Cache the mapping for future use
    this.sessionProjectMap.set(sessionID, session.projectID);
    return session;
  }

  /** Cancel debounce and return any in-flight auto-save payload for this session. */
  private takePendingUpdates(sessionID: string): Partial<Session> | undefined {
    const timeout = this.saveTimeouts.get(sessionID);
    if (timeout) {
      clearTimeout(timeout);
      this.saveTimeouts.delete(sessionID);
    }

    const pending = this.pendingUpdates.get(sessionID);
    if (pending) {
      this.pendingUpdates.delete(sessionID);
    }
    return pending;
  }

  private applyPatchToDraft(draft: Session, patch: OptionalPatch<Session>): void {
    for (const key of Object.keys(patch) as (keyof Session)[]) {
      const val = patch[key];
      if (val === undefined) {
        delete (draft as unknown as Record<string, unknown>)[key as string];
      } else {
        (draft as unknown as Record<string, unknown>)[key as string] = val;
      }
    }
  }

  async update(sessionID: string, updates: OptionalPatch<Session>): Promise<Session> {
    const pending = this.takePendingUpdates(sessionID);
    const projectID =
      this.sessionProjectMap.get(sessionID) ?? (await this.read(sessionID)).projectID;
    const draft = await this.read(sessionID, projectID);

    if (pending && Object.keys(pending).length > 0) {
      this.applyPatchToDraft(draft, pending);
    }
    this.applyPatchToDraft(draft, updates);
    draft.updated_at = new Date().toISOString();

    await this.atomicWriteSession(draft);
    Bus.publish(SessionEvents.Updated, { sessionID, session: draft });
    return draft;
  }

  autoSave(sessionID: string, updates: Partial<Session>): void {
    const existingTimeout = this.saveTimeouts.get(sessionID);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const pending = this.pendingUpdates.get(sessionID) ?? {};
    this.pendingUpdates.set(sessionID, { ...pending, ...updates });

    const timeout = setTimeout(async () => {
      try {
        const merged = this.pendingUpdates.get(sessionID);
        if (merged && Object.keys(merged).length > 0) {
          await this.update(sessionID, merged);
          this.pendingUpdates.delete(sessionID);
        }
      } catch (e) {
        console.error(`Failed to auto-save session ${sessionID}:`, e);
      } finally {
        this.saveTimeouts.delete(sessionID);
      }
    }, this.saveDelay);

    this.saveTimeouts.set(sessionID, timeout);
  }

  /**
   * Write a full session snapshot immediately (used on flush/exit).
   */
  async writeSnapshot(session: Session): Promise<void> {
    this.sessionProjectMap.set(session.id, session.projectID);
    await this.atomicWriteSession(session);
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

  /**
   * Immediately flush a pending auto-save for a session to disk.
   * Clears any debounce timeout and writes immediately.
   */
  async flushSave(sessionID: string): Promise<void> {
    const timeout = this.saveTimeouts.get(sessionID);
    if (timeout) {
      clearTimeout(timeout);
      this.saveTimeouts.delete(sessionID);
    }

    const pending = this.pendingUpdates.get(sessionID);
    if (pending && Object.keys(pending).length > 0) {
      try {
        await this.update(sessionID, pending);
      } catch (e) {
        console.error(`Failed to flush session ${sessionID}:`, e);
      }
      this.pendingUpdates.delete(sessionID);
    }
  }

  /**
   * Flush all pending auto-saves across all sessions.
   * Used on exit to ensure no data loss.
   */
  async flushAllSaves(): Promise<void> {
    const sessionIDs = new Set([
      ...this.saveTimeouts.keys(),
      ...this.pendingUpdates.keys(),
    ]);
    for (const id of sessionIDs) {
      await this.flushSave(id);
    }
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
