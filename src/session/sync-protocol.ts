/**
 * Local-first session sync protocol foundation.
 *
 * This does not implement remote sync. It defines stable envelope shapes future
 * GUI panes or transports can use without embedding a terminal renderer.
 */

export type SyncEventType =
  | "session.snapshot"
  | "session.message.appended"
  | "session.status.changed"
  | "session.closed";

export interface SyncEvent<TPayload = unknown> {
  id: string;
  type: SyncEventType;
  sessionID: string;
  projectID: string;
  createdAt: string;
  payload: TPayload;
}

export interface SyncPeer {
  id: string;
  kind: "cli" | "gui" | "worker" | "remote";
  connectedAt: string;
}

export function createSyncEvent<TPayload>(input: {
  type: SyncEventType;
  sessionID: string;
  projectID: string;
  payload: TPayload;
}): SyncEvent<TPayload> {
  return {
    id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    type: input.type,
    sessionID: input.sessionID,
    projectID: input.projectID,
    createdAt: new Date().toISOString(),
    payload: input.payload,
  };
}
