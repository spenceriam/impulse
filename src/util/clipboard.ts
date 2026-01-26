/**
 * Clipboard utility for cross-platform copy support
 * 
 * Uses OSC 52 escape sequences for SSH compatibility, with fallback to
 * platform-specific native tools (osascript, xclip, wl-copy, powershell).
 */

import { $ } from "bun";
import { platform } from "os";

/**
 * Writes text to clipboard via OSC 52 escape sequence.
 * This allows clipboard operations to work over SSH by having
 * the terminal emulator handle the clipboard locally.
 */
function writeOsc52(text: string): void {
  if (!process.stdout.isTTY) return;
  const base64 = Buffer.from(text).toString("base64");
  const osc52 = `\x1b]52;c;${base64}\x07`;
  // tmux and screen require DCS passthrough wrapping
  const passthrough = process.env["TMUX"] || process.env["STY"];
  const sequence = passthrough ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52;
  process.stdout.write(sequence);
}

/**
 * Lazy initialization helper - caches result of first call
 */
function lazy<T>(fn: () => T): () => T {
  let value: T | undefined;
  let loaded = false;

  return (): T => {
    if (loaded) return value as T;
    loaded = true;
    value = fn();
    return value as T;
  };
}

/**
 * Get platform-specific copy method
 */
const getCopyMethod = lazy(() => {
  const os = platform();

  if (os === "darwin" && Bun.which("osascript")) {
    return async (text: string) => {
      const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      await $`osascript -e 'set the clipboard to "${escaped}"'`.nothrow().quiet();
    };
  }

  if (os === "linux") {
    if (process.env["WAYLAND_DISPLAY"] && Bun.which("wl-copy")) {
      return async (text: string) => {
        const proc = Bun.spawn(["wl-copy"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
        proc.stdin.write(text);
        proc.stdin.end();
        await proc.exited.catch(() => {});
      };
    }
    if (Bun.which("xclip")) {
      return async (text: string) => {
        const proc = Bun.spawn(["xclip", "-selection", "clipboard"], {
          stdin: "pipe",
          stdout: "ignore",
          stderr: "ignore",
        });
        proc.stdin.write(text);
        proc.stdin.end();
        await proc.exited.catch(() => {});
      };
    }
    if (Bun.which("xsel")) {
      return async (text: string) => {
        const proc = Bun.spawn(["xsel", "--clipboard", "--input"], {
          stdin: "pipe",
          stdout: "ignore",
          stderr: "ignore",
        });
        proc.stdin.write(text);
        proc.stdin.end();
        await proc.exited.catch(() => {});
      };
    }
  }

  if (os === "win32") {
    return async (text: string) => {
      // Pipe via stdin to avoid PowerShell string interpolation
      const proc = Bun.spawn(
        [
          "powershell.exe",
          "-NonInteractive",
          "-NoProfile",
          "-Command",
          "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())",
        ],
        {
          stdin: "pipe",
          stdout: "ignore",
          stderr: "ignore",
        },
      );

      proc.stdin.write(text);
      proc.stdin.end();
      await proc.exited.catch(() => {});
    };
  }

  // No native clipboard support - OSC 52 will be the only method
  return async (_text: string) => {
    // OSC 52 is already sent by copy(), this is just a no-op fallback
  };
});

/**
 * Copy text to clipboard
 * 
 * First attempts OSC 52 (works over SSH), then falls back to native methods.
 * 
 * @param text - The text to copy to clipboard
 */
export async function copy(text: string): Promise<void> {
  // Always try OSC 52 first (works over SSH)
  writeOsc52(text);
  // Then use native method as backup
  await getCopyMethod()(text);
}

/**
 * Clipboard namespace for compatibility
 */
export const Clipboard = {
  copy,
};
