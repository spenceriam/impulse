import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  readClipboardFileList,
  WINDOWS_CLIPBOARD_FILELIST_SCRIPT,
} from "../src/cli/clipboard-files.js";

const clipboardFilesSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/cli/clipboard-files.ts"),
  "utf8"
);

describe("readClipboardFileList (#134)", () => {
  test("returns a well-formed result on every platform without throwing", async () => {
    // Best-effort by contract: whatever the platform clipboard holds, the
    // call must resolve to { files, present } — never reject.
    const result = await readClipboardFileList();
    expect(Array.isArray(result.files)).toBe(true);
    expect(typeof result.present).toBe("boolean");
    for (const f of result.files) {
      expect(typeof f).toBe("string");
      expect(f.length).toBeGreaterThan(0);
    }
  });

  test("still exports the shared readClipboardFileList entry point", () => {
    expect(typeof readClipboardFileList).toBe("function");
  });
});

describe("WINDOWS_CLIPBOARD_FILELIST_SCRIPT (#134 FileDrop)", () => {
  test("uses GetFileDropList and prints raw path strings", () => {
    // Regression: Explorer multi-file copy uses DataFormats.FileDrop
    // (CF_HDROP). The broken script checked GetDataPresent('FileDropList')
    // (always False) and then $_.FullName on what would have been strings.
    expect(WINDOWS_CLIPBOARD_FILELIST_SCRIPT).toContain(
      "[System.Windows.Forms.Clipboard]::GetFileDropList()"
    );
    expect(WINDOWS_CLIPBOARD_FILELIST_SCRIPT).toContain(
      "$l | ForEach-Object { $_ }"
    );
    expect(WINDOWS_CLIPBOARD_FILELIST_SCRIPT).toContain(
      "if ($null -eq $l) { exit 1 }"
    );

    // Must not contain the dogfood-broken patterns.
    expect(WINDOWS_CLIPBOARD_FILELIST_SCRIPT).not.toContain(
      "GetDataPresent('FileDropList')"
    );
    expect(WINDOWS_CLIPBOARD_FILELIST_SCRIPT).not.toContain(
      "GetData('FileDropList')"
    );
    expect(WINDOWS_CLIPBOARD_FILELIST_SCRIPT).not.toContain("$_.FullName");
  });
});

describe("macOS + Linux clipboard readers unchanged (#134 Windows-only)", () => {
  // Windows dogfood fix must not rewrite darwin/Linux. Contract-check the
  // source so CI (Linux VM) still guards Finder / X11 / Wayland paths.
  test("macOS path still uses osascript NSFilenames / furl list", () => {
    expect(clipboardFilesSrc).toContain("async function readMacFileList");
    expect(clipboardFilesSrc).toContain("osascript");
    expect(clipboardFilesSrc).toContain("the clipboard as «class furl» list");
    expect(clipboardFilesSrc).toContain("p.replace(/^file:");
  });

  test("Linux path still uses wl-paste then xclip gnome-copied-files", () => {
    expect(clipboardFilesSrc).toContain("async function readLinuxFileList");
    expect(clipboardFilesSrc).toContain("x-special/gnome-copied-files");
    expect(clipboardFilesSrc).toContain('cmd: "wl-paste"');
    expect(clipboardFilesSrc).toContain('cmd: "xclip"');
    expect(clipboardFilesSrc).toContain('"-selection", "clipboard"');
  });
});
