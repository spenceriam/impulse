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
import { applyTitlePolicy } from "../util/title-policy.js";

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

  // Seed per-project taken titles from everything already on disk so the
  // backfill produces the same uniqueness guarantee as live titling (#139).
  const takenByProject = new Map<string, Set<string>>();
  const takenFor = (projectID: string): Set<string> => {
    let set = takenByProject.get(projectID);
    if (!set) {
      set = new Set<string>();
      for (const s of allSessions) {
        if (s.projectID !== projectID) continue;
        const existing = s.headerTitle?.trim();
        if (existing) set.add(existing.toLowerCase());
      }
      takenByProject.set(projectID, set);
    }
    return set;
  };

  let done = 0;
  for (const session of batch) {
    const model = resolveTitleModel(session, config)!;
    done++;

    if (opts.dryRun) {
      opts.onProgress?.(done, batch.length, session.id, "(dry-run)");
      continue;
    }

    try {
      const candidate = await generateTitle(session.messages, model);
      const taken = takenFor(session.projectID);
      const policy = applyTitlePolicy(candidate ?? "", taken);

      if (!policy.ok || !policy.title) {
        result.failed++;
        opts.onProgress?.(done, batch.length, session.id);
        await sleep(delayMs);
        continue;
      }

      await SessionStoreInstance.read(session.id, session.projectID);
      await SessionStoreInstance.update(session.id, {
        headerTitle: policy.title,
        titleMeta: { source: "auto" },
      });
      taken.add(policy.title.toLowerCase());
      result.updated++;
      opts.onProgress?.(done, batch.length, session.id, policy.title);
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
