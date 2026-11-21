/**
 * Test preload: isolate every test run from the developer's real ~/.impulse
 * store (#156). Without this, session-touching tests write into the user's
 * actual session tree, and an interrupted run orphans a session that breaks
 * later runs ("Cap smoke test" → "Cap smoke test (2)" forever).
 */
import fs from "fs";
import os from "os";
import path from "path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-test-home-"));
process.env["IMPULSE_HOME"] = tmpHome;

process.on("exit", () => {
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
