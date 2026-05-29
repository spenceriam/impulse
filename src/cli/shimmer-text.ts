/**
 * Terminal shimmer animation for the busy status line only
 * (Processing..., Working..., etc.).
 * Thinking blocks use static dim color — do not use shimmerText there.
 *
 * Ported from vinhnx/tui-shimmer (cosine band sweep + RGB blend).
 */

const A = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
};

/** Full left-to-right sweep duration (ms). */
export const SHIMMER_SWEEP_MS = 2000;

/** Repaint interval for busy line (ms); decoupled from sweep duration. */
export const SHIMMER_FRAME_MS = 80;

const BAND_HALF_WIDTH = 5;
const SHIMMER_PADDING = 10;

let shimmerStart = Date.now();

/** Reset animation phase (tests). */
export function resetShimmerClock(now = Date.now()): void {
  shimmerStart = now;
}

/** Advance animation phase (tests). */
export function advanceShimmerClock(ms: number): void {
  shimmerStart -= ms;
}

function supportsTrueColor(): boolean {
  if (process.env["NO_COLOR"] !== undefined) return false;
  const force = process.env["CLICOLOR_FORCE"];
  if (force !== undefined && force !== "0") return true;
  const clicolor = process.env["CLICOLOR"];
  if (clicolor === "0") return false;
  const term = process.env["COLORTERM"]?.toLowerCase() ?? "";
  return term.includes("truecolor") || term.includes("24bit");
}

function intensityAtDistance(dist: number): number {
  if (dist > BAND_HALF_WIDTH) return 0;
  const bandHalf = BAND_HALF_WIDTH;
  if (bandHalf <= 0) return 0;
  const x = (Math.PI * dist) / bandHalf;
  return 0.5 * (1 + Math.cos(x));
}

function blendRgb(
  highlight: [number, number, number],
  base: [number, number, number],
  amount: number
): [number, number, number] {
  const t = Math.max(0, Math.min(1, amount));
  const blend = (from: number, to: number) =>
    Math.round(from + (to - from) * t);
  return [
    blend(base[0], highlight[0]),
    blend(base[1], highlight[1]),
    blend(base[2], highlight[2]),
  ];
}

function fgRgb(r: number, g: number, b: number, text: string, bold = false): string {
  const boldSeq = bold ? A.bold : "";
  return `\x1b[38;2;${r};${g};${b}m${boldSeq}${text}${A.reset}`;
}

function fg256(code: number, text: string, bold = false): string {
  const boldSeq = bold ? A.bold : "";
  return `\x1b[38;5;${code}m${boldSeq}${text}${A.reset}`;
}

function indexedToRgb(code: number): [number, number, number] {
  const table: Record<number, [number, number, number]> = {
    236: [30, 30, 30],
    237: [40, 40, 40],
    238: [50, 50, 50],
    240: [70, 70, 70],
    246: [180, 180, 180],
    248: [210, 210, 210],
  };
  return table[code] ?? [128, 128, 128];
}

function shimmerPhase(): number {
  if (SHIMMER_SWEEP_MS <= 0) return 0;
  const elapsed = (Date.now() - shimmerStart) / SHIMMER_SWEEP_MS;
  return elapsed % 1;
}

/** Shimmer highlight across visible characters (matches status-line palette). */
export function shimmerText(message: string, dimBase = false): string {
  const chars = Array.from(message);
  if (chars.length === 0) return "";

  const phase = shimmerPhase();
  const period = chars.length + SHIMMER_PADDING * 2;
  const pos = Math.floor(phase * period);

  const baseCode = dimBase ? 238 : 236;
  const baseRgb = indexedToRgb(baseCode);
  const highlightRgb: [number, number, number] = [255, 255, 255];
  const useTrueColor = supportsTrueColor();

  return chars
    .map((char, index) => {
      if (/\s/.test(char)) return char;

      const iPos = index + SHIMMER_PADDING;
      const dist = Math.abs(iPos - pos);
      const intensity = intensityAtDistance(dist);

      if (useTrueColor) {
        const highlight = Math.min(1, intensity * 0.9);
        const [r, g, b] = blendRgb(highlightRgb, baseRgb, highlight);
        const bold = intensity > 0;
        return fgRgb(r, g, b, char, bold);
      }

      if (intensity <= 0) {
        return fg256(baseCode, char, false);
      }
      if (intensity < 0.2) {
        return fg256(dimBase ? 238 : 236, char, false);
      }
      if (intensity < 0.6) {
        return fg256(dimBase ? 240 : 237, char, false);
      }
      return fg256(dimBase ? 246 : 248, char, true);
    })
    .join("");
}

/** Exported for tests — peak intensity at band center. */
export function shimmerIntensityAtCenter(): number {
  return intensityAtDistance(0);
}
