import fs from "fs";
import path from "path";
import { Global } from "../global";

const MAX_LAG_SAMPLES = 100;

export interface LagSample {
  timestamp: string;
  lagMs: number;
  intervalMs: number;
}

interface CrashArtifact {
  timestamp: string;
  type: "uncaughtException" | "unhandledRejection";
  errorName: string;
  message: string;
  stack?: string;
  pid: number;
  cwd: string;
  platform: NodeJS.Platform;
  nodeVersion: string;
  bunVersion: string | null;
  uptimeSeconds: number;
  memoryRssBytes: number;
  recentLagSamples: LagSample[];
}

const recentLagSamples: LagSample[] = [];
let handlersRegistered = false;
let fatalHandled = false;

export function recordLagSample(sample: LagSample): void {
  recentLagSamples.push(sample);
  if (recentLagSamples.length > MAX_LAG_SAMPLES) {
    recentLagSamples.splice(0, recentLagSamples.length - MAX_LAG_SAMPLES);
  }
}

export function getRecentLagSamples(): LagSample[] {
  return [...recentLagSamples];
}

function toErrorInfo(reason: unknown): { errorName: string; message: string; stack?: string } {
  if (reason instanceof Error) {
    const errorInfo: { errorName: string; message: string; stack?: string } = {
      errorName: reason.name,
      message: reason.message,
    };
    if (reason.stack) {
      errorInfo.stack = reason.stack;
    }
    return errorInfo;
  }

  return {
    errorName: "UnknownError",
    message: typeof reason === "string" ? reason : JSON.stringify(reason),
  };
}

export function captureCrashArtifact(type: "uncaughtException" | "unhandledRejection", reason: unknown): string {
  const errorInfo = toErrorInfo(reason);
  const crashDir = path.join(Global.Path.data, "crash");
  fs.mkdirSync(crashDir, { recursive: true });

  const artifact: CrashArtifact = {
    timestamp: new Date().toISOString(),
    type,
    errorName: errorInfo.errorName,
    message: errorInfo.message,
    ...(errorInfo.stack ? { stack: errorInfo.stack } : {}),
    pid: process.pid,
    cwd: process.cwd(),
    platform: process.platform,
    nodeVersion: process.version,
    bunVersion: process.versions.bun ?? null,
    uptimeSeconds: process.uptime(),
    memoryRssBytes: process.memoryUsage().rss,
    recentLagSamples: getRecentLagSamples(),
  };

  const artifactPath = path.join(crashDir, "last-crash.json");
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
  return artifactPath;
}

export function registerCrashRecoveryHandlers(): void {
  if (handlersRegistered) {
    return;
  }
  handlersRegistered = true;

  const handleFatal = (type: "uncaughtException" | "unhandledRejection", reason: unknown) => {
    if (fatalHandled) {
      return;
    }
    fatalHandled = true;

    try {
      const artifactPath = captureCrashArtifact(type, reason);
      console.error(`[fatal] Crash artifact written: ${artifactPath}`);
    } catch (error) {
      console.error(
        `[fatal] Failed to write crash artifact: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const message = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
    console.error(`[fatal] ${type}: ${message}`);

    // Fail fast to avoid staying in a broken render/runtime loop.
    setTimeout(() => process.exit(1), 10);
  };

  process.on("uncaughtException", (error) => {
    handleFatal("uncaughtException", error);
  });

  process.on("unhandledRejection", (reason) => {
    handleFatal("unhandledRejection", reason);
  });
}
