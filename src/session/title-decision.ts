/**
 * When to (re)title a session (#139).
 *
 * Kept pure and separate from the agent loop so the policy is testable without
 * a provider, and so the automatic path stays completely silent: it never
 * emits a tool call, a tool row, or a status line.
 */

import type { Message } from "./store.js";
import {
  normalizeTitle,
  TITLE_MAX_AUTO_RETITLES,
  TITLE_MIN_USER_TURNS,
  TITLE_RETITLE_INTERVAL,
  titlesOverlap,
} from "../util/title-policy.js";

/**
 * Retitle bookkeeping stored on the session. Local to impulse — never sent to
 * a provider.
 */
export interface TitleMeta {
  /** User-turn count at the last title generation or replacement. */
  lastTitleUserTurns?: number;
  /** Automatic replacements so far. */
  retitleCount?: number;
  /** Who owns the current title. Manual titles are never auto-replaced. */
  source?: "auto" | "manual";
}

/** Char count of assistant text required for a turn to count as substantive. */
export const SUBSTANTIVE_REPLY_CHARS = 80;

export type TitleAction =
  | { action: "generate"; userTurns: number }
  | { action: "reconsider"; userTurns: number }
  | { action: "skip" };

function isUserTurn(message: Message): boolean {
  return message.role === "user" && !message.injected;
}

/** Count real user turns (injected system notes do not count). */
export function countUserTurns(messages: Message[]): number {
  return messages.filter(isUserTurn).length;
}

/**
 * A turn counts as substantive when the assistant did real work — called a
 * tool, or wrote a real reply. Guards against titling "hey, take a look at
 * this" from a throwaway first exchange.
 */
export function lastTurnWasSubstantive(messages: Message[]): boolean {
  const lastUser = [...messages].reverse().find(isUserTurn);
  if (!lastUser) return false;

  let afterUser = false;
  for (const message of messages) {
    if (message === lastUser) {
      afterUser = true;
      continue;
    }
    if (!afterUser) continue;
    if (message.role === "tool" && message.content.trim()) return true;
    if (message.role === "assistant") {
      if ((message.tool_calls?.length ?? 0) > 0) return true;
      if (message.content.trim().length >= SUBSTANTIVE_REPLY_CHARS) return true;
    }
  }

  return false;
}

/**
 * Decide what to do about the session title at the end of a turn.
 *
 * - No title yet: wait for {@link TITLE_MIN_USER_TURNS} real user turns and a
 *   substantive turn, then generate once.
 * - Title already set: reconsider only at {@link TITLE_RETITLE_INTERVAL}
 *   multiples of user turns, never past {@link TITLE_MAX_AUTO_RETITLES}
 *   replacements, and never when the title was set manually.
 */
export function decideTitleAction(opts: {
  messages: Message[];
  currentTitle?: string;
  meta?: TitleMeta;
}): TitleAction {
  const userTurns = countUserTurns(opts.messages);
  if (userTurns === 0) return { action: "skip" };

  const current = (opts.currentTitle ?? "").trim();

  if (!current) {
    if (userTurns < TITLE_MIN_USER_TURNS) return { action: "skip" };
    if (!lastTurnWasSubstantive(opts.messages)) return { action: "skip" };
    return { action: "generate", userTurns };
  }

  // A manual title (set_header) outranks the generator.
  if (opts.meta?.source === "manual") return { action: "skip" };

  if (userTurns < TITLE_RETITLE_INTERVAL) return { action: "skip" };
  if (userTurns % TITLE_RETITLE_INTERVAL !== 0) return { action: "skip" };

  const retitles = opts.meta?.retitleCount ?? 0;
  if (retitles >= TITLE_MAX_AUTO_RETITLES) return { action: "skip" };

  // Skip the LLM call when this boundary was already handled.
  const lastTitled = opts.meta?.lastTitleUserTurns ?? 0;
  if (lastTitled >= userTurns) return { action: "skip" };

  return { action: "reconsider", userTurns };
}

/**
 * Accept a reconsidered title only when the topic actually moved. Returns the
 * candidate when it should replace the current title, otherwise null.
 */
export function acceptRetitle(
  currentTitle: string,
  candidate: string | null,
  overlapThreshold = 0.4
): string | null {
  if (!candidate) return null;
  const current = normalizeTitle(currentTitle);
  const next = normalizeTitle(candidate);
  if (!next) return null;
  if (next.toLowerCase() === current.toLowerCase()) return null;
  if (titlesOverlap(current, next, overlapThreshold)) return null;
  return next;
}
