import { createSignal, onMount, onCleanup } from "solid-js";

/**
 * Bouncing Dots Component
 * Three dots that bounce up/down in sequence during AI processing
 * 
 * Animation: . . .  ->  · . .  ->  . · .  ->  . . ·  ->  . . .
 *            (dot 1 up, dot 2 up, dot 3 up, repeat)
 * 
 * Props:
 * - color: Dot color (defaults to dim gray)
 * - interval: Animation interval in ms (default 200)
 */

interface BouncingDotsProps {
  color?: string;
  interval?: number;
}

// Dot characters: normal and raised
const DOT_NORMAL = "·";
const DOT_RAISED = "•";

export function BouncingDots(props: BouncingDotsProps) {
  const [activeIndex, setActiveIndex] = createSignal(0);
  let intervalId: ReturnType<typeof setInterval> | undefined;
  
  const color = () => props.color || "#666666";
  const interval = () => props.interval || 200;
  
  onMount(() => {
    intervalId = setInterval(() => {
      setActiveIndex((i) => (i + 1) % 4); // 0, 1, 2, 3 (3 = all normal)
    }, interval());
  });
  
  onCleanup(() => {
    if (intervalId) clearInterval(intervalId);
  });
  
  // Get dot character for each position
  const getDot = (index: number): string => {
    const active = activeIndex();
    if (active < 3 && index === active) {
      return DOT_RAISED;
    }
    return DOT_NORMAL;
  };
  
  return (
    <text fg={color()}>
      {getDot(0)} {getDot(1)} {getDot(2)}
    </text>
  );
}
