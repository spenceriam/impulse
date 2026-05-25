/**
 * One-shot backfill of session headerTitle for sessions saved without titles.
 */

import { load as loadConfig, type Config } from "../util/config.js";
import { resetProviderManager } from "../api/manager.js";
import {
  SessionStoreInstance,
  type Session,
} from "./store.js";
import { generateTitle, hasTitleSource } from "./title-generator.js";

export interface EnrichTitlesOptions {
  /** All projects on machine (default) vs current cwd project only */
  projectScope: "all" | "current";
  limit?: number;
  delayMs?: number;
  dryRun?: boolean;
  onProgress?: (
    done: number,
    total: number,
    sessionId: string,
    title?: string
  ) => void;
}

export interface EnrichTitlesResult {
  scanned: number;
  eligible: number;
  updated: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
}

export type TitleEnrichSkipReason =
  | "has_title"
  | "no_messages"
  | "no_title_source"
  | "no_model";

export function isEligibleForTitleEnrichment(
  session: Session
): { eligible: true } | { eligible: false; reason: TitleEnrichSkipReason } {
  if (session.headerTitle?.trim()) {
    return { eligible: false, reason: "has_title" };
  }
  if (!session.messages?.length) {
    return { eligible: false, reason: "no_messages" };
  }
  const userCount = session.messages.filter((m) => m.role === "user").length;
  const hasAssistant = session.messages.some((m) => m.role === "assistant");
  if (userCount < 1 || !hasAssistant) {
    return { eligible: false, reason: "no_title_source" };
  }
  if (!hasTitleSource(session.messages)) {
    return { eligible: false, reason: "no_title_source" };
  }
  return { eligible: true };
}

export function resolveTitleModel(
  session: Session,
  config: Config
): string | null {
  const model = (session.model || config.defaultModel || "").trim();
  return model || null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function enrichSessionTitles(
  opts: EnrichTitlesOptions
): Promise<EnrichTitlesResult> {
  const config = await loadConfig();
  if (!(config.defaultModel ?? "").trim()) {
    throw new Error(
      "No default model configured. Set defaultModel in ~/.impulse/config.json or run impulse --setup."
    );
  }

  resetProviderManager();

  const allSessions =
    opts.projectScope === "all"
      ? await SessionStoreInstance.listAll()
      : await SessionStoreInstance.list();

  const result: EnrichTitlesResult = {
    scanned: allSessions.length,
    eligible: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    dryRun: opts.dryRun ?? false,
  };

  const toProcess: Session[] = [];
  for (const session of allSessions) {
    const check = isEligibleForTitleEnrichment(session);
    if (!check.eligible) {
      result.skipped++;
      continue;
    }
    const model = resolveTitleModel(session, config);
    if (!model) {
      result.skipped++;
      continue;
    }
    toProcess.push(session);
  }

  result.eligible = toProcess.length;
  const limit = opts.limit ?? toProcess.length;
  const batch = toProcess.slice(0, limit);
  const delayMs = opts.delayMs ?? 400;

  let done = 0;
  for (const session of batch) {
    const model = resolveTitleModel(session, config)!;
    done++;

    if (opts.dryRun) {
      opts.onProgress?.(done, batch.length, session.id, "(dry-run)");
      continue;
    }

    try {
      const title = await generateTitle(session.messages, model);
      if (!title) {
        result.failed++;
        opts.onProgress?.(done, batch.length, session.id);
        await sleep(delayMs);
        continue;
      }

      await SessionStoreInstance.read(session.id, session.projectID);
      await SessionStoreInstance.update(session.id, { headerTitle: title });
      result.updated++;
      opts.onProgress?.(done, batch.length, session.id, title);
    } catch (err) {
      result.failed++;
      console.error(`  Failed ${session.id}:`, err);
      opts.onProgress?.(done, batch.length, session.id);
    }

    if (done < batch.length) {
      await sleep(delayMs);
    }
  }

  return result;
}
