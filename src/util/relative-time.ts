const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/** Format a past timestamp as a compact relative string (e.g. "5m ago", "2d ago"). */
export function formatRelativeTimeAgo(iso: string | Date, now = Date.now()): string {
  const dt = iso instanceof Date ? iso : new Date(iso);
  const ms = dt.getTime();
  if (Number.isNaN(ms)) return "—";

  const elapsed = Math.max(0, now - ms);
  if (elapsed < MINUTE_MS) {
    const s = Math.floor(elapsed / SECOND_MS);
    return `${s}s ago`;
  }
  if (elapsed < HOUR_MS) {
    const m = Math.floor(elapsed / MINUTE_MS);
    return `${m}m ago`;
  }
  if (elapsed < DAY_MS) {
    const h = Math.floor(elapsed / HOUR_MS);
    return `${h}h ago`;
  }
  if (elapsed < MONTH_MS) {
    const d = Math.floor(elapsed / DAY_MS);
    return `${d}d ago`;
  }
  if (elapsed < YEAR_MS) {
    const mo = Math.floor(elapsed / MONTH_MS);
    return `${mo}mo ago`;
  }
  const y = Math.floor(elapsed / YEAR_MS);
  return `${y}y ago`;
}
