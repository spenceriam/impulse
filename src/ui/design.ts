/**
 * Design Constants
 * Single source of truth for colors, indicators, and visual elements
 * 
 * Design Philosophy: Brutally Minimal
 * - Function over decoration
 * - Raw and honest
 * - Dense and information-forward
 * - High contrast
 * - Monospace precision
 * - No emojis
 */

/**
 * Color Palette
 */
export const Colors = {
  /**
   * Mode-specific colors (used in mode indicators, input borders)
   */
  mode: {
    AUTO: "#cccccc",      // Soft white/gray - AI decides (less harsh than pure white)
    AGENT: "#5cffff",     // Cyan - Full execution
    PLANNER: "#b48eff",   // Purple - Research + docs
    "PLAN-PRD": "#5c8fff", // Blue - Quick PRD
    DEBUG: "#ffaa5c",     // Orange - Systematic debugging
  },

  /**
   * Status colors (used in tool results, messages)
   */
  status: {
    success: "#6fca6f",   // Green - Operation succeeded
    warning: "#e6c655",   // Yellow - Caution/attention
    error: "#ff6b6b",     // Red - Operation failed
    info: "#5c8fff",      // Blue - Informational
  },

  /**
   * UI element colors
   */
  ui: {
    primary: "#5cffff",   // Cyan - Primary accent
    secondary: "#666666", // Gray - Secondary/muted
    text: "#ffffff",      // White - Primary text
    dim: "#666666",       // Gray - Dimmed text
    background: "#000000", // Black - Background
  },

  /**
   * Message background colors (for user vs AI differentiation)
   */
  message: {
    user: "#2a2a3a",      // Slightly blue-tinted - User messages
    assistant: "#1a1a2a", // Darker - AI messages
    thinking: "#151520",  // Muted - Thinking blocks
  },

  /**
   * Input area colors
   */
  input: {
    background: "#252530", // Input area background
    accent: "#5cffff",     // Mode-colored accent lines (default cyan)
  },

  /**
   * Diff colors (used in file changes)
   */
  diff: {
    addition: "#6fca6f",  // Green - Added lines
    deletion: "#ff6b6b",  // Red - Removed lines
  },
} as const;

/**
 * ASCII Indicators (no emojis)
 */
export const Indicators = {
  /**
   * Expand/collapse indicators
   */
  collapsed: "▶",
  expanded: "▼",

  /**
   * Status dot
   */
  dot: "●",

  /**
   * Todo status indicators
   */
  todo: {
    pending: "[ ]",       // Not started
    in_progress: "[>]",   // Currently working
    completed: "[x]",     // Done
    cancelled: "[-]",     // No longer needed
  },

  /**
    * Tool result indicators (legacy)
    */
  tool: {
    pending: "▶",         // Tool waiting to run
    running: "⣾",         // Tool currently executing (spinner frame)
    success: "[OK]",      // Tool succeeded
    error: "[FAIL]",      // Tool failed
  },

  /**
    * Tool status indicators (new - for collapsible display)
    */
  toolStatus: {
    pending: "·",         // Dot - waiting
    running: "~",         // Tilde - in progress
    success: "✓",         // Checkmark - completed
    error: "✗",           // X - failed
  },

  /**
   * Progress bar characters
   */
  progress: {
    filled: "█",          // Completed portion
    empty: "░",           // Remaining portion
  },

  /**
   * Separators
   */
  separator: {
    vertical: "│",
    horizontal: "─",
    cross: "┼",
    topLeft: "┌",
    topRight: "┐",
    bottomLeft: "└",
    bottomRight: "┘",
    teeLeft: "├",
    teeRight: "┤",
    teeTop: "┬",
    teeBottom: "┴",
  },
} as const;

/**
 * Layout Constants
 */
export const Layout = {
  /**
   * Padding values
   */
  padding: {
    none: 0,
    xs: 1,
    sm: 2,
    md: 4,
    lg: 8,
  },

  /**
   * Sidebar width
   */
  sidebar: {
    width: 40,
    minWidth: 30,
    maxWidth: 60,
  },

  /**
   * Input height
   * Note: Add 1 row for visual breathing room below cursor
   */
  input: {
    minHeight: 4,      // 3 rows visible text + 1 empty row below cursor
    maxHeight: 10,
  },

  /**
   * Progress bar width
   */
  progressBar: {
    width: 10,
  },
} as const;

/**
 * Animation Timing (milliseconds)
 */
export const Timing = {
  /**
   * Event batching interval for streaming
   */
  batchInterval: 16,    // ~60fps

  /**
   * Debounce delay for input
   */
  debounce: 100,

  /**
   * Animation duration
   */
  animation: 150,
} as const;

// Type exports for type-safe usage
export type Mode = keyof typeof Colors.mode;
export type Status = keyof typeof Colors.status;
export type TodoStatus = keyof typeof Indicators.todo;
export type ToolStatus = keyof typeof Indicators.tool;

/**
 * Get mode color by mode name
 */
export function getModeColor(mode: Mode): string {
  return Colors.mode[mode];
}

/**
 * Get status color by status name
 */
export function getStatusColor(status: Status): string {
  return Colors.status[status];
}

/**
 * Get todo indicator by status
 */
export function getTodoIndicator(status: TodoStatus): string {
  return Indicators.todo[status];
}

/**
 * Create a progress bar string
 * @param percent - Progress percentage (0-100)
 * @param width - Width in characters (default 10)
 */
export function createProgressBar(percent: number, width: number = Layout.progressBar.width): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  
  return `[${Indicators.progress.filled.repeat(filled)}${Indicators.progress.empty.repeat(empty)}]`;
}
