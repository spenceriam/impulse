/**
 * Proposal stage over failure clusters (#195, self-improvement route).
 *
 * Propose-only by design: a cluster becomes a written, ranked suggestion the
 * user acts on — nothing edits the harness automatically. Applying self-edits
 * without a validation gate is the documented overfitting failure mode
 * (harness search memorizes the development sample and regresses elsewhere),
 * so the human stays in the loop while clusters prove themselves.
 *
 * Model agnostic: proposals are derived from harness events (tool outcome,
 * error signature, model spread), never from judging model output quality.
 */

import { clusterFailures, type FailureCluster } from "./failure-clusters.js";
import type { TraceRecord } from "./trace.js";

export type ProposalArea =
  | "tool-repair"
  | "tool-interface"
  | "loop-control"
  | "verification"
  | "prompt";

export interface Proposal {
  /** Stable id for referencing a proposal in a later validation step. */
  id: string;
  area: ProposalArea;
  /** Cluster this came from. */
  tool: string;
  count: number;
  /** One-line statement of what to change. */
  summary: string;
  /** Why this was proposed — the evidence, in plain language. */
  rationale: string;
  /** Files or modules to look at first. */
  where: string[];
  /** Lower is more urgent. */
  rank: number;
}

/**
 * Map a tool + error signature to the harness area most likely responsible.
 * Conservative on purpose: an unrecognized signature lands in `verification`
 * ("check the outcome before trusting it") rather than guessing a module.
 */
export function classifyClusterArea(cluster: FailureCluster): ProposalArea {
  const sig = cluster.signature.toLowerCase();
  const tool = cluster.tool.toLowerCase();

  if (/repair|invalid (json|argument|input)|parse|schema|unexpected token/.test(sig)) {
    return "tool-repair";
  }
  if (/rejected|not found|no such|permission denied|invalid path|is a directory/.test(sig)) {
    return "tool-interface";
  }
  if (/timeout|timed out|aborted|empty (turn|response)|loop/.test(sig)) {
    return "loop-control";
  }
  if (tool === "turn" || tool === "stream" || /no error text/.test(sig)) {
    return "verification";
  }
  if (/prompt|context|token|limit/.test(sig)) {
    return "prompt";
  }
  return "verification";
}

const AREA_WHERE: Record<ProposalArea, string[]> = {
  "tool-repair": ["src/tools/input-repair/", "src/tools/registry.ts"],
  "tool-interface": ["src/tools/", "src/permission/"],
  "loop-control": ["src/agent/loop.ts", "src/agent/loop-guard.ts"],
  verification: ["src/agent/loop.ts", "docs/tool-input-repair.md"],
  prompt: ["src/agent/prompts.ts", "src/agent/build-chat-messages.ts"],
};

const AREA_SUMMARY: Record<ProposalArea, (c: FailureCluster) => string> = {
  "tool-repair": (c) =>
    `${c.tool} fails with malformed input — tighten validation or add a repair for this shape`,
  "tool-interface": (c) =>
    `${c.tool} rejects valid-looking requests — review its argument contract or permission path`,
  "loop-control": (c) =>
    `${c.tool} stalls or repeats — add or tune a loop guard for this pattern`,
  verification: (c) =>
    `${c.tool} fails without a clear cause — add a pre-stop check that names the failure`,
  prompt: (c) =>
    `${c.tool} failures look context-related — review prompt assembly or truncation`,
};

/**
 * Turn ranked clusters into ranked proposals.
 *
 * Only clusters with recurrence evidence propose: a single failure is noise.
 * Multi-model clusters rank higher — the same failure across models points at
 * the harness, while one confined to a model is more likely a model limit.
 */
export function proposeFromClusters(
  clusters: FailureCluster[],
  opts: { minCount?: number; maxProposals?: number } = {}
): Proposal[] {
  const minCount = opts.minCount ?? 2;
  const maxProposals = opts.maxProposals ?? 5;

  const proposals: Proposal[] = [];
  for (const cluster of clusters) {
    if (cluster.count < minCount) continue;
    const area = classifyClusterArea(cluster);
    const models = cluster.models.length;
    // Multi-model evidence outranks volume from one model.
    const rank = 100 - (models > 1 ? 50 : 0) - Math.min(cluster.count, 40);
    proposals.push({
      id: `${cluster.tool}:${area}:${cluster.signature.slice(0, 24)}`,
      area,
      tool: cluster.tool,
      count: cluster.count,
      summary: AREA_SUMMARY[area](cluster),
      rationale:
        `${cluster.count} failure(s) with signature "${cluster.signature}"` +
        (models > 1
          ? ` across ${models} models (${cluster.models.join(", ")}) — harness-level, not a model limit`
          : models === 1
            ? ` on ${cluster.models[0]} only — could be a model limit; check before changing the harness`
            : ""),
      where: AREA_WHERE[area],
      rank,
    });
  }

  return proposals
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
    .slice(0, maxProposals);
}

/** Convenience: records straight to proposals. */
export function proposeFromRecords(
  records: TraceRecord[],
  opts: { minCount?: number; maxProposals?: number } = {}
): Proposal[] {
  return proposeFromClusters(clusterFailures(records), opts);
}

/** Render proposals as plain lines (CLI and `/traces --propose` share it). */
export function formatProposals(proposals: Proposal[]): string[] {
  if (proposals.length === 0) {
    return ["No proposals — no recurring failure clusters yet."];
  }
  const lines: string[] = ["Harness proposals (propose-only, nothing applied):", ""];
  for (const p of proposals) {
    lines.push(`  [${p.area}] ${p.summary}`);
    lines.push(`      ${p.rationale}`);
    lines.push(`      look at: ${p.where.join(", ")}`);
  }
  return lines;
}
