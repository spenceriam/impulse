/**
 * PTY Module - Interactive Terminal Support
 * 
 * Exports:
 * - initPty() - Initialize PTY system (call once at startup)
 * - isPtyAvailable() - Check if PTY is ready
 * - executePty() - Execute command with PTY support
 * - writeToPty() - Send input to running PTY
 * - resizePty() - Resize PTY terminal
 * - isPtyActive() - Check if PID has active PTY
 * - getActivePtys() - Get all active PTY PIDs
 * - PtyEvents - Bus event names
 */

export {
  initPty,
  isPtyAvailable,
  executePty,
  writeToPty,
  resizePty,
  isPtyActive,
  getActivePtys,
  PtyEvents,
  type ShellOutputEvent,
  type PtyResult,
  type PtyHandle,
  type AnsiToken,
  type AnsiLine,
  type AnsiOutput,
} from "./service";
