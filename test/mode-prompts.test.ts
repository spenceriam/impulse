import { afterEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { generateSystemPrompt, invalidatePromptCache } from "../src/agent/prompts.js";
import { createDefaultConfig } from "../src/util/config.js";

describe("mode prompts", () => {
  let temp: string | undefined;

  afterEach(async () => {
    invalidatePromptCache();
    if (temp) await fs.rm(temp, { recursive: true, force: true });
  });

  test("ASK is read-only planning and diagnosis while AGENT has execution authority", async () => {
    temp = await fs.mkdtemp(path.join(os.tmpdir(), "impulse-mode-prompts-"));
    const config = createDefaultConfig();
    const promptOptions = { userInstructionsPath: path.join(temp, "instructions.md") };

    const ask = await generateSystemPrompt("ASK", temp, config, promptOptions);
    expect(ask).toContain("## Mode: ASK");
    expect(ask).toContain("read-only");
    expect(ask).toContain("research");
    expect(ask).toContain("planning");
    expect(ask).toContain("diagnosis");
    expect(ask).toContain("cannot write or edit project files");
    expect(ask).toContain("execution_handoff");
    expect(ask).toContain("Preview safely (recommended)");
    expect(ask).toContain("read-only evidence and explore subagents");
    expect(ask).toContain("one minimal command or test");
    expect(ask).toContain("Allow-All is debugging authority or a sandbox");
    expect(ask).toContain("rather than inventing a privileged debug mode");
    expect(ask).toContain("Never silently elevate authority");
    expect(ask).not.toContain("## Mode: EXPLORE");
    expect(ask).not.toContain("## Mode: PLAN");
    expect(ask).not.toContain("## Mode: DEBUG");

    const agent = await generateSystemPrompt("AGENT", temp, config, promptOptions);
    expect(agent).toContain("## Mode: AGENT");
    expect(agent).toContain("execution authority");
    expect(agent).toContain("read, write, and run commands");
    expect(agent).not.toContain("AGENT (default)");
  });
});
