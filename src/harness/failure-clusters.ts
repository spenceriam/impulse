/**
 * Failure clustering over trajectory records (#195, self-improvement route).
 *
 * The diagnose stage of a self-improving harness: group failed turns by tool
 * and error signature, and surface which clusters recur across runs. A cluster
 * that repeats is a harness bottleneck candidate; a one-off is noise. Model
 * agnostic by construction — it reads harness events, never model output
 * quality.
 */

import type { TraceRecord } from "./trace.js";

export interface FailureCluster {
  /** Tool name, or "turn" for turn-level failures with no tool. */
  tool: string;
  /** Normalized error signature shared by the cluster. */
  signature: string;
  /** How many failed steps landed in this cluster. */
  count: number;
  /** Turn indices the cluster appeared in, ascending, deduped. */
  turns: number[];
  /** Model ids involved — a cluster spanning models is a harness issue. */
  models: string[];
  /** One raw example, for the human reading the report. */
  example?: string;
}

/** Collapse variable parts of an error so the same failure groups together. */
export function normalizeErrorSignature(error: string | undefined): string {
  if (!error) return "(no error text)";
  return error
    .replace(/0x[0-9a-f]+/gi, "0x…")
    // Numbers with 4+ digits, including when glued to a unit ("1200ms").
    .replace(/(?<!\d)\d{4,}(?!\d)/g, "N")
    .replace(/\/[\w./-]+\/([\w.-]+)/g, "…/$1")
    .replace(/'[^']{24,}'/g, "'…'")
    .replace(/"[^"]{24,}"/g, '"…"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * Rank failure clusters across records. Only turns that failed contribute;
 * a cluster spanning multiple models is a stronger harness signal than one
 * confined to a single model, so it sorts first at equal counts.
 */
export function clusterFailures(records: TraceRecord[]): FailureCluster[] {
  const clusters = new Map<string, FailureCluster>();

  const add = (tool: string, signature: string, record: TraceRecord, example?: string) => {
    const key = `${tool}\u0000${signature}`;
    const existing = clusters.get(key);
    if (existing) {
      existing.count += 1;
      if (!existing.turns.includes(record.turn)) existing.turns.push(record.turn);
      if (record.model && !existing.models.includes(record.model)) {
        existing.models.push(record.model);
      }
      return;
    }
    clusters.set(key, {
      tool,
      signature,
      count: 1,
      turns: [record.turn],
      models: record.model ? [record.model] : [],
      ...(example ? { example } : {}),
    });
  };

  for (const record of records) {
    for (const step of record.steps.tools) {
      if (step.outcome === "success") continue;
      add(step.name, normalizeErrorSignature(step.error), record, step.error);
    }
    // Turn-level failure with no failing tool recorded.
    if (record.outcome === "failed" && record.steps.tools.every((t) => t.outcome === "success")) {
      add(record.failingTool ?? "turn", normalizeErrorSignature(record.error), record, record.error);
    }
  }

  return [...clusters.values()].sort(
    (a, b) =>
      b.count - a.count ||
      b.models.length - a.models.length ||
      a.tool.localeCompare(b.tool)
  );
}

export interface FailureReport {
  totalTurns: number;
  failedTurns: number;
  clusters: FailureCluster[];
}

export function buildFailureReport(records: TraceRecord[]): FailureReport {
  // A turn counts as failed when its outcome says so OR a tool step failed —
  // records written by older turns may carry a success outcome with a failed
  // step, and the report should not undercount.
  const failedTurns = records.filter(
    (r) =>
      r.outcome !== "success" ||
      r.steps.tools.some((t) => t.outcome !== "success")
  ).length;
  return {
    totalTurns: records.length,
    failedTurns,
    clusters: clusterFailures(records),
  };
}

/** Render the report as plain lines (CLI and in-session command share it). */
export function formatFailureReport(report: FailureReport, maxClusters = 10): string[] {
  const lines: string[] = [];
  if (report.totalTurns === 0) {
    return ["No trace records yet — traces are written per turn."];
  }
  const pct = Math.round((report.failedTurns / report.totalTurns) * 100);
  lines.push(
    `${report.totalTurns} turns · ${report.failedTurns} failed (${pct}%)`
  );
  if (report.clusters.length === 0) {
    lines.push("No failure clusters — every recorded turn succeeded.");
    return lines;
  }
  lines.push("");
  for (const cluster of report.clusters.slice(0, maxClusters)) {
    const spread =
      cluster.models.length > 1 ? ` · ${cluster.models.length} models` : "";
    lines.push(
      `  ${cluster.count}× ${cluster.tool}${spread} — ${cluster.signature}`
    );
    lines.push(`      turns ${cluster.turns.slice(0, 8).join(", ")}`);
  }
  const hidden = report.clusters.length - maxClusters;
  if (hidden > 0) lines.push(`  … ${hidden} more cluster(s)`);
  return lines;
}

/**
 * A cluster worth acting on: it recurs, and it is not confined to one model
 * (which would suggest a model capability limit rather than a harness flaw).
 */
export function isHarnessBottleneck(cluster: FailureCluster, minCount = 3): boolean {
  return cluster.count >= minCount && cluster.models.length >= 2;
}
