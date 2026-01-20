import { Indicators } from "../design";

/**
 * Progress Bar Component
 * Displays context usage as a visual progress bar
 * 
 * NOTE: Returns a <span> so it can be used inside <text> elements.
 * Do NOT wrap this in another <text> - use it directly inside <text>.
 */

export function ProgressBar(props: { percent: number; width?: number }) {
  const width = props.width ?? 10;
  const filled = Math.round((props.percent / 100) * width);
  const empty = width - filled;

  const bar = `[${Indicators.progress.filled.repeat(filled)}${Indicators.progress.empty.repeat(empty)}] ${props.percent}%`;

  return <span>{bar}</span>;
}
