/**
 * Validation gate for harness proposals (#195, self-improvement route).
 *
 * A proposal is a hypothesis ("tighten the file_edit repair layer"), and the
 * documented failure mode of harness self-improvement is accepting a hypothesis
 * because it looks right on the sample that produced it. The gate is therefore
 * built on held-out evidence:
 *
 *   1. Split records into baseline (older) and recent (newer) by time.
 *   2. A proposal is only *supported* if its failure signature also occurs in
 *      the held-out recent half at a similar-or-worse rate. A signature that
 *      vanished in the recent half is already fixed or was a fluke.
 *   3. Score = recurrence in the held-out half × model spread. Higher means
 *      more worth acting on.
 *
 * No provider call, no LLM judge: the gate is deterministic so the same
 * records always produce the same verdict.
 */

import type { Proposal } from "./proposals.js";
import { clusterFailures } from "./failure-clusters.js";
import type { TraceRecord } from "./trace.js";

export type Verdict = "supported" | "weak" | "already-fixed";

export interface ValidatedProposal extends Proposal {
  verdict: Verdict;
  /** Held-out score: recurrence in the recent half, weighted by model spread. */
  score: number;
  /** Occurrences in the baseline half. */
  baselineCount: number;
  /** Occurrences in the held-out (recent) half. */
  heldOutCount: number;
  modelsInHeldOut: number;
}

/**
 * Split records chronologically. Timestamps are the only ordering the records
 * carry, so the split is by time, not by array position.
 */
export function splitRecords(
  records: TraceRecord[],
  fraction = 0.5
): { baseline: TraceRecord[]; heldOut: TraceRecord[] } {
  if (records.length < 2) return { baseline: records, heldOut: [] };
  const sorted = [...records].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const cut = Math.max(1, Math.floor(sorted.length * (1 - fraction)));
  return {
    baseline: sorted.slice(0, cut),
    heldOut: sorted.slice(cut),
  };
}

function countFor(
  records: TraceRecord[],
  tool: string,
  signature: string
): { count: number; models: Set<string> } {
  const models = new Set<string>();
  let count = 0;
  for (const cluster of clusterFailures(records)) {
    if (cluster.tool !== tool || cluster.signature !== signature) continue;
    count += cluster.count;
    for (const m of cluster.models) models.add(m);
  }
  return { count, models };
}

/**
 * Validate proposals against held-out records.
 *
 * - `supported`: recurs in the held-out half across ≥ 2 models, or repeats
 *   there at all when the baseline was single-model.
 * - `weak`: recurs only once, or is confined to one model.
 * - `already-fixed`: absent from the held-out half.
 */
export function validateProposals(
  proposals: Proposal[],
  records: TraceRecord[],
  fraction = 0.5
): ValidatedProposal[] {
  const { baseline, heldOut } = splitRecords(records, fraction);

  const validated = proposals.map((p): ValidatedProposal => {
    const base = countFor(baseline, p.tool, p.signature);
    const recent = countFor(heldOut, p.tool, p.signature);
    const modelsInHeldOut = recent.models.size;

    let verdict: Verdict;
    if (recent.count === 0) verdict = "already-fixed";
    else if (recent.count >= 2 && modelsInHeldOut >= 2) verdict = "supported";
    else verdict = "weak";

    const score =
      recent.count === 0
        ? 0
        : recent.count * (modelsInHeldOut >= 2 ? 2 : 1);

    return {
      ...p,
      verdict,
      score,
      baselineCount: base.count,
      heldOutCount: recent.count,
      modelsInHeldOut,
    };
  });

  return validated.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** Render validated proposals, marking the verdict inline. */
export function formatValidatedProposals(validated: ValidatedProposal[]): string[] {
  if (validated.length === 0) {
    return ["No proposals to validate."];
  }
  const supported = validated.filter((v) => v.verdict === "supported");
  const lines: string[] = [
    `Validated against held-out turns: ${supported.length} supported, ` +
      `${validated.filter((v) => v.verdict === "weak").length} weak, ` +
      `${validated.filter((v) => v.verdict === "already-fixed").length} already fixed`,
    "",
  ];
  for (const v of validated) {
    const mark =
      v.verdict === "supported" ? "✓" : v.verdict === "weak" ? "~" : "·";
    lines.push(
      `  ${mark} [${v.area}] ${v.summary}`
    );
    lines.push(
      `      ${v.verdict} · ${v.baselineCount} before → ${v.heldOutCount} after` +
        (v.modelsInHeldOut > 0 ? ` · ${v.modelsInHeldOut} model(s) after` : "")
    );
  }
  return lines;
}
