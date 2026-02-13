import { isDebugEnabled, logEventLoopLag } from "./debug-log";

export interface LagSample {
  timestamp: string;
  lagMs: number;
  intervalMs: number;
}

interface LagMonitorOptions {
  intervalMs?: number;
  warnMs?: number;
  logThrottleMs?: number;
  consoleWarnMs?: number;
  onLag?: (sample: LagSample) => void;
}

const MAX_RECENT_SAMPLES = 256;
const recentLagSamples: LagSample[] = [];

function recordLagSample(sample: LagSample): void {
  recentLagSamples.push(sample);
  if (recentLagSamples.length > MAX_RECENT_SAMPLES) {
    recentLagSamples.splice(0, recentLagSamples.length - MAX_RECENT_SAMPLES);
  }
}

export function getRecentLagSamples(limit: number = 50): LagSample[] {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  return recentLagSamples.slice(-normalizedLimit);
}

export function startEventLoopLagMonitor(options: LagMonitorOptions = {}): () => void {
  const intervalMs = options.intervalMs ?? 500;
  const warnMs = options.warnMs ?? 200;
  const logThrottleMs = options.logThrottleMs ?? 5000;
  const consoleWarnMs = options.consoleWarnMs ?? 2000;

  let last = Date.now();
  let lastLogged = 0;

  const timer = setInterval(() => {
    const now = Date.now();
    const lag = now - last - intervalMs;
    last = now;

    if (lag < warnMs) return;

    const sample: LagSample = {
      timestamp: new Date(now).toISOString(),
      lagMs: lag,
      intervalMs,
    };
    recordLagSample(sample);

    if (now - lastLogged >= logThrottleMs) {
      lastLogged = now;
      if (isDebugEnabled()) {
        void logEventLoopLag({ lagMs: lag, intervalMs });
      }
    }

    if (lag >= consoleWarnMs) {
      console.warn(`[perf] Event loop lag detected: ${lag}ms`);
    }

    try {
      options.onLag?.(sample);
    } catch {
      // Keep lag monitor non-fatal; callbacks must not destabilize the app.
    }
  }, intervalMs);

  return () => {
    clearInterval(timer);
  };
}
