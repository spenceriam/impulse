import { isDebugEnabled, logEventLoopLag } from "./debug-log";

interface LagMonitorOptions {
  intervalMs?: number;
  warnMs?: number;
  logThrottleMs?: number;
  consoleWarnMs?: number;
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

    if (now - lastLogged >= logThrottleMs) {
      lastLogged = now;
      if (isDebugEnabled()) {
        void logEventLoopLag({ lagMs: lag, intervalMs });
      }
    }

    if (lag >= consoleWarnMs) {
      console.warn(`[perf] Event loop lag detected: ${lag}ms`);
    }
  }, intervalMs);

  return () => {
    clearInterval(timer);
  };
}
