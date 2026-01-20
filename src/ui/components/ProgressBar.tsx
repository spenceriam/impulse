import { Indicators } from "../design";

/**
 * Progress Bar Component
 * Displays context usage as a visual progress bar
 */

export function ProgressBar(props: { percent: number; width?: number }) {
  const width = props.width ?? 10;
  const filled = Math.round((props.percent / 100) * width);
  const empty = width - filled;

  return (
    <text>
      <text>[</text>
      <text>{Indicators.progress.filled.repeat(filled)}</text>
      <text>{Indicators.progress.empty.repeat(empty)}</text>
      <text>] {props.percent}%</text>
    </text>
  );
}
