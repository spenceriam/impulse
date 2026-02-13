import fs from "fs";
import path from "path";
import { Global } from "../global";
import { getRecentLagSamples, type LagSample } from "./lag-monitor";

const CRASH_DIR = path.join(Global.Path.config, "crash");
const LAST_CRASH_PATH = path.join(CRASH_DIR, "last-crash.json");
const RECOVERY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface CrashArtifact {
  version: string;
  timestamp: string;
  pid: number;
  argv: string[];
  cwd: string;
  type: "uncaughtException" | "unhandledRejection";
  errorName: string;
  message: string;
  stack?: string;
  uptimeSeconds: number;
  memoryRssBytes: number;
  recentLagSamples: LagSample[];
}

export interface CrashRecoveryHint {
  forceVerbose: boolean;
  notice?: string;
}

let handlersInstalled = false;
let crashRecorded = false;
let fatalExitStarted = false;

function ensureCrashDir(): void {
  fs.mkdirSync(CRASH_DIR, { recursive: true });
}

function normalizeReason(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  return new Error(String(reason));
}

function writeCrashArtifact(
  version: string,
  type: CrashArtifact["type"],
  reason: unknown
): void {
  const error = normalizeReason(reason);
  const artifact: CrashArtifact = {
    version,
    timestamp: new Date().toISOString(),
    pid: process.pid,
    argv: process.argv.slice(),
    cwd: process.cwd(),
    type,
    errorName: error.name || "Error",
    message: error.message || String(reason),
    uptimeSeconds: process.uptime(),
    memoryRssBytes: process.memoryUsage().rss,
    recentLagSamples: getRecentLagSamples(80),
  };
  if (error.stack) {
    artifact.stack = error.stack;
  }

  ensureCrashDir();
  fs.writeFileSync(LAST_CRASH_PATH, JSON.stringify(artifact, null, 2), "utf8");
}

export function installCrashRecoveryHandlers(version: string): void {
  if (handlersInstalled) return;
  handlersInstalled = true;

  const recordCrash = (type: CrashArtifact["type"], reason: unknown): void => {
    if (crashRecorded) return;
    crashRecorded = true;
    try {
      writeCrashArtifact(version, type, reason);
      process.stderr.write(
        `\n[crash] Artifact saved to ${LAST_CRASH_PATH}\n`
      );
    } catch (error) {
      process.stderr.write(
        `\n[crash] Failed to persist crash artifact: ${String(error)}\n`
      );
    }
  };

  const exitAfterFatal = (): void => {
    if (fatalExitStarted) return;
    fatalExitStarted = true;
    process.exit(1);
  };

  process.on("uncaughtException", (error) => {
    recordCrash("uncaughtException", error);
    exitAfterFatal();
  });

  process.on("unhandledRejection", (reason) => {
    recordCrash("unhandledRejection", reason);
    exitAfterFatal();
  });
}

export function consumeCrashRecoveryHint(): CrashRecoveryHint {
  try {
    if (!fs.existsSync(LAST_CRASH_PATH)) {
      return { forceVerbose: false };
    }

    const raw = fs.readFileSync(LAST_CRASH_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<CrashArtifact>;
    const timestamp = parsed.timestamp ? Date.parse(parsed.timestamp) : NaN;
    const ageMs = Number.isFinite(timestamp) ? Date.now() - timestamp : Infinity;

    ensureCrashDir();
    const archiveName = `crash-${Date.now()}.json`;
    const archivePath = path.join(CRASH_DIR, archiveName);
    fs.renameSync(LAST_CRASH_PATH, archivePath);

    if (ageMs > RECOVERY_MAX_AGE_MS) {
      return { forceVerbose: false };
    }

    const when = Number.isFinite(timestamp)
      ? new Date(timestamp).toLocaleString("en-US")
      : "recent run";

    return {
      forceVerbose: true,
      notice: `Previous crash detected (${when}). Verbose diagnostics enabled for this run.`,
    };
  } catch {
    return { forceVerbose: false };
  }
}
