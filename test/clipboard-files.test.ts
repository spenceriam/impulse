import { describe, expect, test } from "bun:test";
import {
  readClipboardFileList,
  WINDOWS_CLIPBOARD_FILELIST_SCRIPT,
} from "../src/cli/clipboard-files.js";

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
