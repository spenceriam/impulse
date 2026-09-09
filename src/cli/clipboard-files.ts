/**
 * Clipboard file-list reading (issue #134).
 *
 * Terminals deliver clipboard TEXT to stdin — and when a user copies
 * multiple files in Explorer/Finder/file manager, that text contains only
 * the first file's path (verified on Windows Terminal: FileDropList has N
 * files, CF_TEXT carries 1). To make multi-file paste work, we read the
 * platform clipboard file-list directly and fall back to text when absent.
 *
 * Per-OS clipboard formats:
 * - Windows: CF_HDROP / "Shell IDList Array" — via PowerShell interop
 * - macOS:   NSPasteboard NSFilenamesPboardType — via `osascript`
 * - Linux:   freedesktop `x-special/gnome-copied-files` (X11 via xclip,
 *            Wayland via wl-paste)
 *
 * All functions are best-effort: any failure returns { files: [] } and the
 * caller falls back to the text buffer. No OS-specific import-time work.
 */

export interface ClipboardFileList {
  /** Absolute file paths from the clipboard file-list format. Empty when
   *  the clipboard holds no file list (plain text, image bitmap, empty). */
  files: string[];
  /** True when the clipboard provably holds a file list (even if empty). */
  present: boolean;
}

/** Read the clipboard file list for the current platform. */
export async function readClipboardFileList(): Promise<ClipboardFileList> {
  switch (process.platform) {
    case "win32":
      return readWindowsFileList();
    case "darwin":
      return readMacFileList();
    default:
      return readLinuxFileList();
  }
}

const CLIP_TIMEOUT_MS = 2000;

// ── Windows ──────────────────────────────────────────────────────────────────

async function readWindowsFileList(): Promise<ClipboardFileList> {
  // Read CF_HDROP via System.Windows.Forms — the same list Explorer writes
  // for copied files. PowerShell runs detached with a short timeout so a
  // locked clipboard degrades to "no file list" quickly.
  const script =
    "$ErrorActionPreference='Stop';" +
    "Add-Type -AssemblyName System.Windows.Forms;" +
    "$d=[System.Windows.Forms.Clipboard]::GetDataObject();" +
    "if ($d -and $d.GetDataPresent('FileDropList')) {" +
    "$l=$d.GetData('FileDropList');$l | ForEach-Object { $_.FullName }" +
    "}";
  try {
    const { execFile } = await import("child_process");
    const out = await new Promise<string>((resolve) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { timeout: CLIP_TIMEOUT_MS, windowsHide: true },
        (err, stdout) => resolve(err ? "" : (stdout ?? ""))
      );
    });
    const files = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return { files, present: true };
  } catch {
    return { files: [], present: false };
  }
}

// ── macOS ────────────────────────────────────────────────────────────────────

async function readMacFileList(): Promise<ClipboardFileList> {
  // NSFilenamesPboardType via osascript; empty output = no file list.
  const script =
    'osascript -e \'set fl to (the clipboard as «class furl» list)\' 2>/dev/null';
  try {
    const { exec } = await import("child_process");
    const out = await new Promise<string>((resolve) => {
      exec(script, { timeout: CLIP_TIMEOUT_MS }, (err, stdout) =>
        resolve(err ? "" : (stdout ?? ""))
      );
    });
    // osascript prints one POSIX path per line for furl lists.
    const files = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((p) => p.replace(/^file:\/\//, ""));
    return { files, present: true };
  } catch {
    return { files: [], present: false };
  }
}

// ── Linux (X11 + Wayland) ────────────────────────────────────────────────────

async function readLinuxFileList(): Promise<ClipboardFileList> {
  const { execFile } = await import("child_process");
  const tryRead = (cmd: string, args: string[]): Promise<string> =>
    new Promise((resolve) => {
      execFile(cmd, args, { timeout: CLIP_TIMEOUT_MS }, (err, stdout) =>
        resolve(err ? "" : (stdout ?? ""))
      );
    });

  // wl-paste (Wayland) first, xclip (X11) second.
  const targets = [
    { cmd: "wl-paste", args: ["-t", "x-special/gnome-copied-files"] },
    { cmd: "xclip", args: ["-selection", "clipboard", "-t", "x-special/gnome-copied-files", "-o"] },
  ];
  for (const t of targets) {
    try {
      const out = await tryRead(t.cmd, t.args);
      if (!out) continue;
      // Format: first line is the operation ("copy"|"cut"), then one URI per
      // line as file:// URLs.
      const lines = out.split(/\r?\n/).filter(Boolean);
      const files = lines
        .slice(lines[0] === "copy" || lines[0] === "cut" ? 1 : 0)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((u) => {
          try {
            return u.startsWith("file://") ? decodeURIComponent(new URL(u).pathname) : u;
          } catch {
            return u;
          }
        });
      return { files, present: true };
    } catch {
      continue;
    }
  }
  return { files: [], present: false };
}