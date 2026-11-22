import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { installBundledSkill } from "../src/skills/default-skills.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-skill-install-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("installBundledSkill (#138)", () => {
  test("copies a bundled skill into the project and records it in the marker", async () => {
    const result = await installBundledSkill(tmp, "tdd");
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(tmp, ".agents", "skills", "tdd", "SKILL.md"))).toBe(true);

    const marker = JSON.parse(
      fs.readFileSync(path.join(tmp, ".impulse", "default-skills.json"), "utf-8")
    );
    expect(marker["tdd"]).toBeString();
  });

  test("never overwrites an existing same-named skill", async () => {
    const dir = path.join(tmp, ".agents", "skills", "tdd");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: mine\n---\n# mine\n");

    const result = await installBundledSkill(tmp, "tdd");
    expect(result.ok).toBe(false);
    expect(fs.readFileSync(path.join(dir, "SKILL.md"), "utf-8")).toContain("mine");
  });

  test("unknown skill is refused", async () => {
    const result = await installBundledSkill(tmp, "no-such-skill-xyz");
    expect(result.ok).toBe(false);
  });
});
