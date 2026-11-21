/**
 * Structured per-turn trajectory records (#195).
 *
 * One JSONL record per turn, schema-versioned, written under
 * `~/.impulse/traces/<projectID>/<sessionID>.jsonl`. This is the dataset a
 * self-improving harness needs: diagnose -> propose -> validate -> deploy
 * requires complete, replayable trajectories with the verifier outcome attached,
 * not a human-oriented debug log.
 *
 * The record is a byproduct of the turn (emitted from the same places that
 * produce Quiet narration and settle lines), never a parallel code path.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { Global } from "../global.js";
import { getCurrentProjectID } from "../session/store.js";
import type { QuietRecapEvent } from "../cli/quiet-status.js";

/** Bump when the shape changes in a way that breaks readers. */
export const TRACE_SCHEMA_VERSION = 1;

/** Rotate a trace file past this size so a long session stays readable. */
export const TRACE_MAX_BYTES = 8 * 1024 * 1024;

export type TraceToolOutcome = "success" | "failed" | "blocked" | "aborted";

export interface TraceToolStep {
  name: string;
  /** Repaired arguments as executed. */
  args?: unknown;
  /** Raw arguments when the input-repair layer changed them. */
  rawArgs?: string;
  outcome: TraceToolOutcome;
  durationMs?: number;
  /** Size of the tool output in chars (content itself stays in the session). */
  outputChars?: number;
  truncated?: boolean;
  error?: string;
}

export interface TracePermissionStep {
  tool: string;
  decision: "allowed" | "denied" | "asked";
  scope?: "once" | "session" | "always" | "directory";
}

export interface TraceRecord {
  schema: number;
  /** Turn index within the session. */
  turn: number;
  timestamp: string;
  mode: string;
  model: string;
  provider?: string;
  input: {
    messageCount: number;
    estimatedTokens?: number;
    /** Provider-reported prompt tokens, when the provider sent usage. */
    promptTokens?: number;
    cachedTokens?: number;
    /** Hash of system prompt + tool definitions — the cacheable prefix. */
    prefixHash?: string;
  };
  steps: {
    tools: TraceToolStep[];
    permissions: TracePermissionStep[];
  };
  outcome: "success" | "failed" | "blocked" | "aborted" | "cancelled";
  failingTool?: string;
  error?: string;
  /** External check result, so a trajectory carries a label, not just a story. */
  verifier?: { name: string; passed: boolean; detail?: string };
  retry?: { fired: boolean; kind?: "recipe" | "loop-nudge" | "steer" };
  /** Subagents spawned this turn, by codename. */
  subagents?: string[];
}

function traceDir(projectID = getCurrentProjectID()): string {
  return path.join(Global.Path.home, "traces", projectID);
}

export function traceFilePath(sessionID: string, projectID?: string): string {
  return path.join(traceDir(projectID), `${sessionID}.jsonl`);
}

/**
 * Append one record. Best-effort by design: tracing must never break a turn,
 * so every failure is swallowed (a missing disk is not a reason to fail).
 */
export async function appendTraceRecord(
  sessionID: string,
  record: TraceRecord
): Promise<void> {
  try {
    const file = traceFilePath(sessionID);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const line = JSON.stringify(record) + "\n";
    try {
      const stat = await fs.stat(file);
      if (stat.size > TRACE_MAX_BYTES) {
        await fs.rename(file, `${file}.${Date.now()}.bak`);
      }
    } catch {
      // No file yet — nothing to rotate.
    }
    await fs.appendFile(file, line, "utf-8");
  } catch {
    // Tracing is a byproduct, never a requirement.
  }
}

/** Read every record for a session (used by `--trace <id>` and replay). */
export async function readTraceRecords(
  sessionID: string,
  projectID?: string
): Promise<TraceRecord[]> {
  try {
    const raw = await fs.readFile(traceFilePath(sessionID, projectID), "utf-8");
    const records: TraceRecord[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed) as TraceRecord);
      } catch {
        // Skip a torn line (process killed mid-write).
      }
    }
    return records;
  } catch {
    return [];
  }
}

/**
 * Replay a record into the event shape the Quiet path consumes, so a trace
 * can be re-rendered or re-scored offline without a provider (#195).
 */
export function replayTraceRecord(record: TraceRecord): QuietRecapEvent[] {
  return record.steps.tools.map((step) => ({
    name: step.name,
    arg: typeof step.args === "string" ? step.args : "",
    outcome:
      step.outcome === "success"
        ? "success"
        : step.outcome === "failed"
          ? "failed"
          : step.outcome === "blocked"
            ? "blocked"
            : "aborted",
  }));
}

/** Sessions that have trace files, newest first. */
export async function listTracedSessions(
  projectID = getCurrentProjectID()
): Promise<string[]> {
  try {
    const entries = await fs.readdir(traceDir(projectID));
    return entries
      .filter((e) => e.endsWith(".jsonl"))
      .map((e) => e.replace(/\.jsonl$/, ""))
      .sort();
  } catch {
    return [];
  }
}
