import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  DefaultSkillScaffolding,
  ensureDefaultSkills,
} from "../src/skills/default-skills.js";
import { listInstalledSkills } from "../src/tools/install-skill-source.js";

describe("ensureDefaultSkills", () => {
  let defaultsDir: string;
  let cwd: string;
  const originalEnv = process.env["IMPULSE_DEFAULT_SKILLS_DIR"];

  function writeFixtureSkill(slug: string, opts: { version?: string; body?: string } = {}): void {
    const dir = path.join(defaultsDir, slug);
    fs.mkdirSync(dir, { recursive: true });
    const version = opts.version ?? "1.0.0";
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: ${slug}\ncommand: ${slug}\nversion: "${version}"\ndescription: test skill\n---\n\n${opts.body ?? "Body v" + version}\n`
    );
  }

  beforeEach(() => {
    defaultsDir = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-defaults-src-"));
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-defaults-cwd-"));
    process.env["IMPULSE_DEFAULT_SKILLS_DIR"] = defaultsDir;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env["IMPULSE_DEFAULT_SKILLS_DIR"];
    else process.env["IMPULSE_DEFAULT_SKILLS_DIR"] = originalEnv;
    fs.rmSync(defaultsDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test("copies a missing default skill into .agents/skills on first run", async () => {
    writeFixtureSkill("sample-skill");
    await ensureDefaultSkills(cwd);

    const installed = path.join(cwd, ".agents", "skills", "sample-skill", "SKILL.md");
    expect(fs.existsSync(installed)).toBe(true);
    expect(fs.readFileSync(installed, "utf-8")).toContain("Body v1.0.0");
  });

  test("a second run with the same version is a no-op (doesn't touch the file)", async () => {
    writeFixtureSkill("sample-skill");
    await ensureDefaultSkills(cwd);

    const installed = path.join(cwd, ".agents", "skills", "sample-skill", "SKILL.md");
    const firstMtime = fs.statSync(installed).mtimeMs;

    await new Promise((r) => setTimeout(r, 10));
    await ensureDefaultSkills(cwd);

    expect(fs.statSync(installed).mtimeMs).toBe(firstMtime);
  });

  test("refreshes when the bundled version changes and the skill isn't edited", async () => {
    writeFixtureSkill("sample-skill", { version: "1.0.0" });
    await ensureDefaultSkills(cwd);

    writeFixtureSkill("sample-skill", { version: "1.1.0", body: "Body v1.1.0 updated" });
    await ensureDefaultSkills(cwd);

    const installed = path.join(cwd, ".agents", "skills", "sample-skill", "SKILL.md");
    expect(fs.readFileSync(installed, "utf-8")).toContain("Body v1.1.0 updated");
  });

  test("never overwrites a skill the user marked edited: true", async () => {
    writeFixtureSkill("sample-skill", { version: "1.0.0" });
    await ensureDefaultSkills(cwd);

    const installed = path.join(cwd, ".agents", "skills", "sample-skill", "SKILL.md");
    fs.writeFileSync(
      installed,
      `---\nname: sample-skill\ncommand: sample-skill\nversion: "1.0.0"\nedited: true\ndescription: test skill\n---\n\nMy custom edits.\n`
    );

    writeFixtureSkill("sample-skill", { version: "2.0.0", body: "Should not appear" });
    await ensureDefaultSkills(cwd);

    expect(fs.readFileSync(installed, "utf-8")).toContain("My custom edits.");
    expect(fs.readFileSync(installed, "utf-8")).not.toContain("Should not appear");
  });

  test("does not resurrect a default skill the user deleted", async () => {
    writeFixtureSkill("sample-skill");
    await ensureDefaultSkills(cwd);

    const installedDir = path.join(cwd, ".agents", "skills", "sample-skill");
    fs.rmSync(installedDir, { recursive: true, force: true });

    await ensureDefaultSkills(cwd);

    expect(fs.existsSync(installedDir)).toBe(false);
  });

  test("does not overwrite a pre-existing user skill with the same slug on first scaffold", async () => {
    const userSkillDir = path.join(cwd, ".agents", "skills", "sample-skill");
    fs.mkdirSync(userSkillDir, { recursive: true });
    fs.writeFileSync(path.join(userSkillDir, "SKILL.md"), "---\nname: sample-skill\n---\n\nUser's own skill.\n");

    writeFixtureSkill("sample-skill");
    await ensureDefaultSkills(cwd);

    expect(fs.readFileSync(path.join(userSkillDir, "SKILL.md"), "utf-8")).toContain("User's own skill.");
  });

  test("ASK startup and resume are write-free until an explicit AGENT transition scaffolds once", async () => {
    writeFixtureSkill("sample-skill");
    const userSkillDir = path.join(cwd, ".agents", "skills", "user-skill");
    const userSkillPath = path.join(userSkillDir, "SKILL.md");
    fs.mkdirSync(userSkillDir, { recursive: true });
    fs.writeFileSync(
      userSkillPath,
      "---\nname: user-skill\ndescription: existing readable skill\n---\n\nUser content.\n"
    );
    const userContent = fs.readFileSync(userSkillPath, "utf-8");
    const scaffolding = new DefaultSkillScaffolding(cwd);

    expect(await scaffolding.initialize("ASK", "startup")).toBe(false);
    expect(await scaffolding.initialize("ASK", "session-resume")).toBe(false);
    expect(await scaffolding.initialize("AGENT", "startup")).toBe(false);
    expect(fs.readdirSync(path.join(cwd, ".agents", "skills"))).toEqual(["user-skill"]);
    expect(fs.readFileSync(userSkillPath, "utf-8")).toBe(userContent);
    expect(fs.existsSync(path.join(cwd, ".impulse"))).toBe(false);
    expect(listInstalledSkills(cwd).map((skill) => skill.slug)).toEqual(["user-skill"]);

    expect(await scaffolding.initialize("AGENT", "explicit-user-transition")).toBe(true);
    const installed = path.join(cwd, ".agents", "skills", "sample-skill", "SKILL.md");
    const marker = path.join(cwd, ".impulse", "default-skills.json");
    expect(fs.existsSync(installed)).toBe(true);
    expect(fs.existsSync(marker)).toBe(true);
    const installedMtime = fs.statSync(installed).mtimeMs;
    const markerMtime = fs.statSync(marker).mtimeMs;

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await scaffolding.initialize("AGENT", "explicit-user-transition")).toBe(false);
    expect(fs.statSync(installed).mtimeMs).toBe(installedMtime);
    expect(fs.statSync(marker).mtimeMs).toBe(markerMtime);
  });
});
