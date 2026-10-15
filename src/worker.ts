#!/usr/bin/env node
/**
 * Impulse Factory worker entry point.
 *
 * This entry deliberately avoids importing Impulse application modules before it
 * has read its job and established an isolated HOME/working directory. That
 * lets one binary serve multiple factory jobs without sharing process-global
 * provider, session, mode, or permission state.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

export const FACTORY_WORKER_PROTOCOL = "impulse-factory-worker/v1";
export const FACTORY_RESULT_PROTOCOL = "impulse-factory-result/v1";

interface WorkerArgs {
  probe: boolean;
  help: boolean;
  jobPath?: string;
  promptPath?: string;
  timeoutMs?: number;
}

interface FactoryArtifacts {
  runDir: string;
  stageDir: string;
  resultPath: string;
}

interface FactoryJob {
  protocolVersion: string;
  workerProtocol: string;
  runId: string;
  stage: string;
  resultPath: string;
  artifacts: FactoryArtifacts;
  repository: {
    workdir: string;
  };
  inference?: {
    defaultProvider?: string;
    defaultModel?: string;
  };
  provider?: {
    type?: string;
    baseUrl?: string;
    secretRef?: string;
  };
  permissions?: {
    allowAll?: boolean;
    externalSandbox?: boolean;
  };
}

interface ResultBlocker {
  code: string;
  message: string;
  needsOwnerDecision?: boolean;
}

interface ResultCommand {
  command: string;
  exitCode: number;
}

export function parseWorkerArgs(argv: string[]): WorkerArgs {
  const result: WorkerArgs = { probe: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--factory-protocol") {
      result.probe = true;
      const value = argv[index + 1];
      if (value && value !== FACTORY_WORKER_PROTOCOL) {
        throw new Error(`Unsupported factory protocol: ${value}`);
      }
      if (value) index += 1;
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--job") {
      const value = argv[index + 1];
      if (!value) throw new Error("--job requires a file path");
      result.jobPath = value;
      index += 1;
    } else if (arg === "--prompt") {
      const value = argv[index + 1];
      if (!value) throw new Error("--prompt requires a file path");
      result.promptPath = value;
      index += 1;
    } else if (arg === "--timeout-ms") {
      const value = Number(argv[index + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("--timeout-ms requires a positive number");
      }
      result.timeoutMs = value;
      index += 1;
    } else {
      throw new Error(`Unknown worker argument: ${arg}`);
    }
  }
  return result;
}

function usage(): string {
  return `impulse-worker — unattended Impulse factory worker

Usage:
  impulse-worker --factory-protocol
  impulse-worker --factory-protocol ${FACTORY_WORKER_PROTOCOL} --job JOB.json --prompt PROMPT.md [--timeout-ms N]
`;
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

export function validateJob(input: unknown): FactoryJob {
  if (!isRecord(input)) throw new Error("job must be a JSON object");
  const value = input as Partial<FactoryJob>;
  if (value.protocolVersion !== FACTORY_RESULT_PROTOCOL) {
    throw new Error(`job.protocolVersion must be ${FACTORY_RESULT_PROTOCOL}`);
  }
  if (value.workerProtocol !== FACTORY_WORKER_PROTOCOL) {
    throw new Error(`job.workerProtocol must be ${FACTORY_WORKER_PROTOCOL}`);
  }
  nonEmptyString(value.runId, "job.runId");
  nonEmptyString(value.stage, "job.stage");
  const resultPath = nonEmptyString(value.resultPath ?? value.artifacts?.resultPath, "job.artifacts.resultPath");
  const runDir = nonEmptyString(value.artifacts?.runDir, "job.artifacts.runDir");
  const stageDir = nonEmptyString(value.artifacts?.stageDir, "job.artifacts.stageDir");
  const workdir = nonEmptyString(value.repository?.workdir, "job.repository.workdir");
  if (!path.isAbsolute(resultPath)) throw new Error("job.artifacts.resultPath must be absolute");
  if (!path.isAbsolute(runDir)) throw new Error("job.artifacts.runDir must be absolute");
  if (!path.isAbsolute(stageDir)) throw new Error("job.artifacts.stageDir must be absolute");
  if (!path.isAbsolute(workdir)) throw new Error("job.repository.workdir must be absolute");
  if (!fs.existsSync(workdir) || !fs.statSync(workdir).isDirectory()) {
    throw new Error(`job.repository.workdir is not a directory: ${workdir}`);
  }
  const resolvedResult = path.resolve(resultPath);
  const resolvedStage = path.resolve(stageDir);
  if (!resolvedResult.startsWith(`${resolvedStage}${path.sep}`)) {
    throw new Error("job.artifacts.resultPath must be inside job.artifacts.stageDir");
  }
  return {
    ...(value as FactoryJob),
    resultPath,
    artifacts: { runDir, stageDir, resultPath },
    repository: { workdir },
  };
}

function emit(event: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
}

function writeResult(
  job: FactoryJob,
  result: {
    status: "completed" | "blocked" | "failed";
    summary: string;
    blockers?: ResultBlocker[];
    commands?: ResultCommand[];
    metrics?: Record<string, unknown>;
    data?: Record<string, unknown>;
    error?: string;
  }
): string {
  const payload = {
    protocolVersion: FACTORY_RESULT_PROTOCOL,
    stage: job.stage,
    status: result.status,
    summary: result.summary,
    artifacts: [
      {
        path: job.resultPath!,
        type: "application/json",
        description: "Validated worker terminal result",
      },
    ],
    ...(result.commands ? { commands: result.commands } : {}),
    ...(result.blockers ? { blockers: result.blockers } : {}),
    ...(result.metrics ? { metrics: result.metrics } : {}),
    ...(result.data ? { data: result.data } : {}),
    ...(result.error ? { data: { ...(result.data ?? {}), error: result.error } } : {}),
  };
  fs.mkdirSync(path.dirname(job.resultPath!), { recursive: true });
  fs.writeFileSync(job.resultPath!, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return job.resultPath!;
}

function prepareIsolatedHome(job: FactoryJob): string {
  const home = path.join(job.artifacts!.runDir!, ".impulse-home");
  const configDir = path.join(home, ".impulse");
  const emptySkills = path.join(home, "empty-skills");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(emptySkills, { recursive: true });

  const config: Record<string, unknown> = {
    defaultMode: "AGENT",
    hasSeenWelcome: true,
    userProfile: {
      name: "impulse-factory-worker",
      responsePreference: "technical",
      customInstructions: "",
    },
  };
  if (job.inference?.defaultProvider) config["defaultProvider"] = job.inference.defaultProvider;
  if (job.inference?.defaultModel) config["defaultModel"] = job.inference.defaultModel;

  if (job.provider?.type) {
    const isAnthropic = job.provider.type === "anthropic-compatible";
    const providerKey = isAnthropic ? "anthropic" : "openai";
    const apiKeyEnv = isAnthropic ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    config["defaultProvider"] = providerKey;
    config["providers"] = {
      [providerKey]: {
        ...(job.provider.baseUrl ? { baseUrl: job.provider.baseUrl } : {}),
        type: job.provider.type,
      },
    };
    const secretRef = job.provider.secretRef;
    if (secretRef?.startsWith("env:")) {
      const sourceEnv = secretRef.slice(4);
      const secret = process.env[sourceEnv];
      if (secret) process.env[apiKeyEnv] = secret;
    }
  }

  fs.writeFileSync(path.join(configDir, "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

  process.env["HOME"] = home;
  process.env["USERPROFILE"] = home;
  process.env["IMPULSE_DEFAULT_SKILLS_DIR"] = emptySkills;
  process.env["NO_COLOR"] = "1";
  return home;
}

async function runWorker(job: FactoryJob, promptText: string, timeoutMs?: number): Promise<number> {
  prepareIsolatedHome(job);
  process.chdir(job.repository!.workdir!);

  const [
    { AgentLoop },
    { SessionManager },
    { Bus },
    { PermissionEvents, respond },
    { QuestionEvents },
    { rejectQuestion },
    { initPty },
    { load },
    { setAllowAllBypass },
    { cleanupAllBgJobsSync },
  ] = await Promise.all([
    import("./agent/loop.js"),
    import("./session/manager.js"),
    import("./bus/index.js"),
    import("./permission/index.js"),
    import("./bus/events.js"),
    import("./tools/question.js"),
    import("./pty/index.js"),
    import("./util/config.js"),
    import("./permission/index.js"),
    import("./tools/bg-process-registry.js"),
  ]);
  await import("./tools/init.js");
  await initPty();
  process.on("exit", () => cleanupAllBgJobsSync());

  const config = await load({ refresh: true });
  SessionManager.setOptions({
    defaultMode: "AGENT",
    ...(job.inference?.defaultModel ? { defaultModel: job.inference.defaultModel } : {}),
  });

  if (
    job.permissions?.allowAll === true &&
    job.permissions?.externalSandbox === true
  ) {
    setAllowAllBypass(true);
    emit({ type: "permission.decision", decision: "allow-all", reason: "external sandbox declared" });
  }

  const blockers: ResultBlocker[] = [];
  const commands: ResultCommand[] = [];
  let providerError: string | null = null;
  let timedOut = false;
  let lastUsage: Record<string, unknown> | null = null;
  let assistantText = "";

  const unsubscribe = Bus.subscribe((event) => {
    if (event.type === PermissionEvents.Asked.name) {
      const request = event.properties as { id?: string };
      blockers.push({
        code: "WORKER_PERMISSION_REQUIRED",
        message: "A tool permission required an owner decision in unattended mode.",
        needsOwnerDecision: true,
      });
      if (request.id) {
        respond({ permissionID: request.id, response: "reject", message: "Unattended worker cannot request permission" });
      }
      emit({ type: "permission.decision", decision: "reject", permissionID: request.id });
    }
    if (event.type === QuestionEvents.Asked.name) {
      blockers.push({
        code: "WORKER_QUESTION_REQUIRED",
        message: "The worker asked a question and no owner was available.",
        needsOwnerDecision: true,
      });
      rejectQuestion(new Error("Question cancelled by unattended worker"));
      emit({ type: "question.blocked" });
    }
  });

  emit({ type: "worker.started", stage: job.stage, runId: job.runId });

  const loop = new AgentLoop();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const execution = loop.run(promptText, "AGENT", {
      onTurnStart: () => emit({ type: "turn.started" }),
      onToken: (text) => {
        assistantText += text;
      },
      onThinking: (text) => emit({ type: "assistant.thinking", length: text.length }),
      onAdvisorStart: (model) => emit({ type: "advisor.started", model }),
      onAdvisorToken: (text) => emit({ type: "advisor.token", length: text.length }),
      onAdvisorEnd: (summary) => emit({ type: "advisor.finished", length: summary.length }),
      onToolStart: (_id, name, args) => {
        emit({ type: "tool.started", tool: name });
        const command = args["command"];
        if (name === "bash" && typeof command === "string") {
          commands.push({ command, exitCode: -1 });
        }
      },
      onToolEnd: (_id, name, result, durationMs) => {
        emit({ type: "tool.finished", tool: name, success: result.success, durationMs });
        const command = result.metadata?.["command"];
        if (name === "bash" && typeof command === "string") {
          const entry = commands.find((item) => item.command === command && item.exitCode === -1);
          if (entry) entry.exitCode = result.success ? 0 : 1;
          else commands.push({ command, exitCode: result.success ? 0 : 1 });
        }
      },
      onCompacting: () => emit({ type: "context.compacting" }),
      onCompacted: (removedCount) => emit({ type: "context.compacted", removedCount }),
      onTurnEnd: (usage) => {
        lastUsage = {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          contextPct: usage.contextPct,
          tokensPerSecond: usage.tokensPerSecond,
          durationMs: usage.durationMs,
          ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
        };
      },
      onHardCutoff: (contextTokens) => emit({ type: "context.hard_cutoff", contextTokens }),
      onError: (error) => {
        providerError = error.message;
        emit({ type: "worker.error", error: error.message });
      },
      onPlanApproval: async () => {
        blockers.push({
          code: "WORKER_PLAN_APPROVAL_REQUIRED",
          message: "Advisor plan approval is unavailable in unattended mode.",
          needsOwnerDecision: true,
        });
        return "decline";
      },
      onTaskBatchPermission: async () => {
        blockers.push({
          code: "WORKER_TASK_BATCH_PERMISSION_REQUIRED",
          message: "Parallel sub-agent batch approval is unavailable in unattended mode.",
          needsOwnerDecision: true,
        });
        return { action: "cancel" as const };
      },
      onLoopCheckin: async () => {
        blockers.push({
          code: "WORKER_LOOP_CHECKIN_REQUIRED",
          message: "The worker reached its loop check-in gate.",
          needsOwnerDecision: true,
        });
        return "stop" as const;
      },
    });
    execution.catch((error) => {
      providerError = error instanceof Error ? error.message : String(error);
      emit({ type: "worker.error", error: providerError });
    });

    if (timeoutMs !== undefined) {
      await Promise.race([
        execution,
        new Promise<void>((resolve) => {
          timeoutId = setTimeout(() => {
            timedOut = true;
            loop.abort();
            emit({ type: "worker.timeout", timeoutMs });
            resolve();
          }, timeoutMs);
        }),
      ]);
    } else {
      await execution;
    }
  } catch (error) {
    providerError = error instanceof Error ? error.message : String(error);
    emit({ type: "worker.error", error: providerError });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    unsubscribe();
  }

  if (timedOut) {
    providerError = `Worker timed out after ${timeoutMs}ms`;
  }

  const session = SessionManager.getCurrentSession();
  const finalAssistant = [...(session?.messages ?? [])]
    .reverse()
    .find((message) => message.role === "assistant");
  const finalText = (finalAssistant?.content ?? assistantText).trim();
  let data: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(finalText) as unknown;
    if (isRecord(parsed)) data = parsed;
  } catch {
    data = finalText ? { response: finalText } : undefined;
  }

  const hasProvider = Object.values(config.providers ?? {}).some((provider) => provider?.apiKey || provider?.baseUrl);
  if (!hasProvider) {
    blockers.push({
      code: "WORKER_PROVIDER_NOT_CONFIGURED",
      message: "No Impulse provider credentials are available to the isolated worker.",
      needsOwnerDecision: true,
    });
  }

  const status = providerError ? "failed" : blockers.length > 0 ? "blocked" : "completed";
  const summary = providerError
    ? `Worker failed: ${providerError}`
    : blockers.length > 0
      ? `Worker blocked: ${blockers[0]!.message}`
      : finalText.slice(0, 300) || "Worker completed without a final response.";

  writeResult(job, {
    status,
    summary,
    blockers,
    commands,
    metrics: {
      ...(lastUsage ?? {}),
      sessionID: session?.id,
      model: session?.model,
    },
    ...(data ? { data } : {}),
    ...(providerError ? { error: providerError } : {}),
  });
  emit({ type: "worker.finished", stage: job.stage, status });
  return status === "completed" ? 0 : status === "blocked" ? 2 : 1;
}

async function main(): Promise<number> {
  const args = parseWorkerArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return 0;
  }
  if (args.probe && !args.jobPath && !args.promptPath) {
    process.stdout.write(`${FACTORY_WORKER_PROTOCOL}\n`);
    return 0;
  }
  if (!args.jobPath || !args.promptPath) {
    throw new Error("--job and --prompt are required");
  }
  const job = validateJob(readJson(args.jobPath));
  const promptText = fs.readFileSync(args.promptPath, "utf8");
  return await runWorker(job, promptText, args.timeoutMs);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`impulse-worker: ${error.message}\n`);
      process.exitCode = 1;
    }
  );
}
