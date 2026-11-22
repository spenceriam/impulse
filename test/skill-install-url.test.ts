import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { installSkillFromUrl } from "../src/tools/install-skill-source.js";

const originalFetch = globalThis.fetch;

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-skill-url-"));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function fakeFetch(body: string, status = 200): void {
  globalThis.fetch = (async () =>
    new Response(body, { status })) as unknown as typeof fetch;
}

const SKILL_MD = "---\nname: from-web\ndescription: fetched\n---\n\n# From Web\n\nDo the thing.\n";

describe("installSkillFromUrl (#138)", () => {
  test("writes SKILL.md under a slug from the URL", async () => {
    fakeFetch(SKILL_MD);
    const result = await installSkillFromUrl(tmp, "https://example.com/skills/from-web/SKILL.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slug).toBe("from-web");
    expect(fs.readFileSync(path.join(tmp, ".agents", "skills", "from-web", "SKILL.md"), "utf-8")).toBe(
      SKILL_MD
    );
  });

  test("rejects a non-URL", async () => {
    const result = await installSkillFromUrl(tmp, "not a url");
    expect(result).toEqual({ ok: false, reason: "not a URL" });
  });

  test("rejects a non-http protocol", async () => {
    const result = await installSkillFromUrl(tmp, "file:///etc/passwd");
    expect(result.ok).toBe(false);
  });

  test("rejects an HTML page that is not a SKILL.md", async () => {
    fakeFetch("<html><body>404</body></html>");
    const result = await installSkillFromUrl(tmp, "https://example.com/skill.md");
    expect(result.ok).toBe(false);
  });

  test("reports an HTTP error instead of writing", async () => {
    fakeFetch("nope", 404);
    const result = await installSkillFromUrl(tmp, "https://example.com/a/SKILL.md");
    expect(result).toEqual({ ok: false, reason: "HTTP 404" });
  });

  test("refuses to overwrite an existing skill", async () => {
    const dir = path.join(tmp, ".agents", "skills", "from-web");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: mine\n---\n# mine\n");
    fakeFetch(SKILL_MD);
    const result = await installSkillFromUrl(tmp, "https://example.com/skills/from-web/SKILL.md");
    expect(result.ok).toBe(false);
  });
});
