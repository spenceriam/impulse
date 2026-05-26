import { SessionStoreInstance, type Session } from "./store.js";

/** True when the user sent at least one message (resume-worthy session). */
export function sessionHasResumeableContent(session: Session): boolean {
  return session.messages.some((m) => m.role === "user");
}

export interface SessionListSummary {
  total: number;
  resumeable: number;
  empty: number;
  withHeaderTitle: number;
  resumeableUntitled: number;
}

export async function summarizeSessions(
  projectScope: "all" | "current"
): Promise<SessionListSummary> {
  const sessions =
    projectScope === "all"
      ? await SessionStoreInstance.listAll()
      : await SessionStoreInstance.list();

  let resumeable = 0;
  let empty = 0;
  let withHeaderTitle = 0;
  let resumeableUntitled = 0;

  for (const s of sessions) {
    if (sessionHasResumeableContent(s)) {
      resumeable++;
      if (s.headerTitle?.trim()) {
        withHeaderTitle++;
      } else {
        resumeableUntitled++;
      }
    } else {
      empty++;
    }
  }

  return {
    total: sessions.length,
    resumeable,
    empty,
    withHeaderTitle,
    resumeableUntitled,
  };
}
