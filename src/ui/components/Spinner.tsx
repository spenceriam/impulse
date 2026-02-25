import { createSignal, onMount, onCleanup, Show, For } from "solid-js";
import { Colors } from "../design";

/**
 * Spinner Component
 * Animated DNA helix spinner for loading/processing states
 * 
 * Uses braille patterns to create a twisting double-helix effect
 * 
 * Props:
 * - color: Optional color override (defaults to mode cyan)
 * - label: Optional text label after spinner
 * - interval: Animation interval in ms (default 120)
 */

interface SpinnerProps {
  color?: string;
  label?: string;
  interval?: number;
}

// DNA Helix animation frames using braille whitespace pattern
// Creates a rotating/twisting double helix effect
const DNA_HELIX_FRAMES = [
  "⣾",
  "⣽",
  "⣻",
  "⢿",
  "⡿",
  "⣟",
  "⣯",
  "⣷",
];

export function Spinner(props: SpinnerProps) {
  const [frameIndex, setFrameIndex] = createSignal(0);
  
  const color = () => props.color || Colors.mode.WORK;
  const interval = () => props.interval || 120;
  
  let intervalId: ReturnType<typeof setInterval> | undefined;
  
  onMount(() => {
    intervalId = setInterval(() => {
      setFrameIndex((i) => (i + 1) % DNA_HELIX_FRAMES.length);
    }, interval());
  });
  
  onCleanup(() => {
    if (intervalId) clearInterval(intervalId);
  });
  
  const frame = () => DNA_HELIX_FRAMES[frameIndex()];
  
  return (
    <box flexDirection="row" gap={1}>
      <text fg={color()}>{frame()}</text>
      <Show when={props.label}>
        <text fg={Colors.ui.dim}>{props.label}</text>
      </Show>
    </box>
  );
}

/**
 * StackedSpinner Component
 * Vertical stack of spinners with staggered timing and gradient colors
 * Matches the IMPULSE logo gradient colors
 * 
 * Props:
 * - height: Number of spinner rows (default 3)
 * - interval: Base animation interval in ms (default 100)
 */

interface StackedSpinnerProps {
  height?: number;
  interval?: number;
  static?: boolean;  // Show static last frame (idle after processing)
}

// IMPULSE logo gradient colors (cyan to dim)
const GRADIENT_COLORS = [
  "#5cffff", // Brightest cyan
  "#4ad4d4",
  "#38a9a9",
  "#267e7e",
  "#1a6666",
  "#666666", // Dim
];

export function StackedSpinner(props: StackedSpinnerProps) {
  const height = () => props.height || 3;
  const baseInterval = () => props.interval || 100;
  const isStatic = () => props.static || false;
  
  // Each row has its own frame index for staggered effect
  const [frameIndices, setFrameIndices] = createSignal<number[]>([]);
  
  let intervalIds: ReturnType<typeof setInterval>[] = [];
  
  onMount(() => {
    // For static mode, use the last frame (⣷) for all rows
    if (isStatic()) {
      const lastFrameIndex = DNA_HELIX_FRAMES.length - 1;
      setFrameIndices(Array.from({ length: height() }, () => lastFrameIndex));
      return;
    }
    
    // Initialize with random starting positions for variation
    const initial = Array.from({ length: height() }, () => 
      Math.floor(Math.random() * DNA_HELIX_FRAMES.length)
    );
    setFrameIndices(initial);
    
    // Create staggered intervals for each row
    for (let i = 0; i < height(); i++) {
      // Slight variation in timing for organic feel (80-120ms range)
      const rowInterval = baseInterval() + (Math.random() * 40 - 20);
      
      const id = setInterval(() => {
        setFrameIndices((indices) => {
          const newIndices = [...indices];
          const current = newIndices[i] ?? 0;
          newIndices[i] = (current + 1) % DNA_HELIX_FRAMES.length;
          return newIndices;
        });
      }, rowInterval);
      
      intervalIds.push(id);
    }
  });
  
  onCleanup(() => {
    intervalIds.forEach((id) => clearInterval(id));
    intervalIds = [];
  });
  
  // Get color for each row based on position (dimmer when static)
  const getColor = (index: number): string => {
    if (isStatic()) {
      return Colors.ui.dim;  // Dimmed when idle
    }
    const colorIndex = Math.floor((index / height()) * GRADIENT_COLORS.length);
    return GRADIENT_COLORS[Math.min(colorIndex, GRADIENT_COLORS.length - 1)] || "#5cffff";
  };
  
  const getFrame = (index: number): string => {
    const indices = frameIndices();
    const frameIdx = indices[index] ?? 0;
    return DNA_HELIX_FRAMES[frameIdx] ?? "⣾";
  };
  
  return (
    <box flexDirection="column" width={2} flexShrink={0}>
      <For each={Array.from({ length: height() }, (_, i) => i)}>
        {(index) => (
          <text fg={getColor(index)}>{getFrame(index)}</text>
        )}
      </For>
    </box>
  );
}
