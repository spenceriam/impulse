import type { ToolResult } from "../tools/registry";
import { buildTaskThoroughnessNote, prependToolNote } from "../tools/tool-notes";
import {
  executeSubagent,
  type SubagentType,
  type Thoroughness,
} from "./task-runner.js";

export const MAX_CONCURRENT_SUBAGENTS = 8;

/** Delay before each sub-agent's first inference call: index × this value (ms). */
export const SUBAGENT_START_STAGGER_MS = 1_500;

async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) return;

  await new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type TaskCallSpec = {
  toolCallId: string;
  subagentType: SubagentType;
  prompt: string;
  description: string;
  thoroughness?: Thoroughness;
};

export type TaskBatchRunOptions = {
  maxConcurrent?: number;
  signal?: AbortSignal;
  /** Override stagger for tests; defaults to SUBAGENT_START_STAGGER_MS. */
  startStaggerMs?: number;
  /** When false, sub-agents do not publish thinking... progress lines. */
  subagentThinkingEnabled?: boolean;
  /** Provider/model for all subagents in this batch. */
  model?: string;
  onTaskStatus?: (toolCallId: string, status: "queued" | "running" | "done") => void;
};

export type TaskBatchEntry = {
  result: ToolResult;
  durationMs: number;
};

export function formatTaskToolResultFromRun(
  spec: Pick<TaskCallSpec, "subagentType" | "prompt" | "description" | "thoroughness">,
  run: Awaited<ReturnType<typeof executeSubagent>>
): ToolResult {
  const thoroughnessNote = buildTaskThoroughnessNote({
    subagent_type: spec.subagentType,
    thoroughness: spec.thoroughness,
    prompt: spec.prompt,
    description: spec.description,
  });

  let output = run.output;
  if (run.summary.length > 0) {
    const summaryText = run.summary.map((s) => `  - ${s}`).join("\n");
    output = `Actions taken:\n${summaryText}\n\nResult:\n${output}`;
  }
  output = prependToolNote(output, thoroughnessNote);

  return {
    success: run.success,
    output,
    metadata: {
      type: "task",
      subagentType: spec.subagentType,
      description: spec.description,
      toolCallCount: run.actions.length,
      actions: run.actions,
    },
  };
}

/**
 * Run subagent tasks with a concurrency cap. Waits for all tasks to finish.
 */
export async function runTaskBatch(
  calls: TaskCallSpec[],
  options: TaskBatchRunOptions = {}
): Promise<Map<string, TaskBatchEntry>> {
  const maxConcurrent = Math.max(
    1,
    Math.min(options.maxConcurrent ?? MAX_CONCURRENT_SUBAGENTS, MAX_CONCURRENT_SUBAGENTS)
  );
  const staggerMs = options.startStaggerMs ?? SUBAGENT_START_STAGGER_MS;
  const results = new Map<string, TaskBatchEntry>();
  if (calls.length === 0) return results;

  for (const call of calls) {
    options.onTaskStatus?.(call.toolCallId, "queued");
  }

  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      if (options.signal?.aborted) return;

      const index = nextIndex;
      if (index >= calls.length) return;
      nextIndex += 1;

      const spec = calls[index]!;

      await abortableSleep(index * staggerMs, options.signal);
      if (options.signal?.aborted) return;

      options.onTaskStatus?.(spec.toolCallId, "running");

      const started = Date.now();
      const run = await executeSubagent(
        spec.subagentType,
        spec.prompt,
        spec.description,
        spec.thoroughness,
        {
          parentToolCallId: spec.toolCallId,
          signal: options.signal,
          subagentThinkingEnabled: options.subagentThinkingEnabled,
          model: options.model,
        }
      );
      results.set(spec.toolCallId, {
        result: formatTaskToolResultFromRun(spec, run),
        durationMs: Date.now() - started,
      });
      options.onTaskStatus?.(spec.toolCallId, "done");
    }
  }

  const workerCount = Math.min(maxConcurrent, calls.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}
