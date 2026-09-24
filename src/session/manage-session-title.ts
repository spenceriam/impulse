/**
 * Automatic session title management (#139).
 *
 * Runs at the end of a turn, after all of that turn's UI events have been
 * emitted. It must stay completely invisible: no tool call, no tool row, no
 * status line, no chat line. The only visible effect is the header text.
 */

import { generateTitle } from "./title-generator.js";
import { SessionManager } from "./manager.js";
import { acceptRetitle, decideTitleAction, type TitleMeta } from "./title-decision.js";
import type { Message } from "./store.js";

export interface ManageSessionTitleOptions {
  messages: Message[];
  /** Current header title, if any. */
  currentTitle?: string;
  /** Retitle bookkeeping for the session. */
  meta?: TitleMeta;
  /** Model used for the title call. When null, nothing happens. */
  model: string | null;
  /**
   * Override the title call. Used by tests to avoid network access.
   */
  generate?: (messages: Message[], model: string) => Promise<string | null>;
}

export interface ManageSessionTitleResult {
  /** True when the stored title changed. */
  updated: boolean;
  /** The title now stored. */
  title?: string;
  /** Set when a title was written. */
  reason?: "generated" | "retitled";
}

/**
 * Decide, generate, and store a session title. Returns whether the caller
 * should notify listeners (the header line owns the only visible update).
 */
export async function manageSessionTitle(
  opts: ManageSessionTitleOptions
): Promise<ManageSessionTitleResult> {
  const decision = decideTitleAction({
    messages: opts.messages,
    ...(opts.currentTitle ? { currentTitle: opts.currentTitle } : {}),
    ...(opts.meta ? { meta: opts.meta } : {}),
  });

  if (decision.action === "skip" || !opts.model) {
    return { updated: false };
  }

  const generate = opts.generate ?? generateTitle;
  const candidate = await generate(opts.messages, opts.model);

  const nextTitle =
    decision.action === "generate"
      ? candidate
      : acceptRetitle(opts.currentTitle ?? "", candidate);

  if (!nextTitle) return { updated: false };

  const result = await SessionManager.setHeaderTitle(nextTitle, {
    source: "auto",
    meta: {
      lastTitleUserTurns: decision.userTurns,
      retitleCount:
        decision.action === "reconsider"
          ? (opts.meta?.retitleCount ?? 0) + 1
          : 0,
    },
  });

  if (result.rejected || result.unchanged) return { updated: false };

  return {
    updated: true,
    title: result.title,
    reason: decision.action === "reconsider" ? "retitled" : "generated",
  };
}
