import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import path from "path";
import { buildChatMessages } from "../src/agent/build-chat-messages.js";
import { generateSystemPrompt, invalidatePromptCache } from "../src/agent/prompts.js";
import type { Config } from "../src/util/config.js";
import { replaceUserInstructions } from "../src/util/user-instructions.js";

const projectDir = mkdtempSync(path.join(process.cwd(), ".tmp-user-prompt-"));
const instructionsPath = path.join(projectDir, "user-instructions.md");

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("user instructions provider integration", () => {
  test("new and resumed sessions receive the exact persisted Markdown", async () => {
    const content = "# Persistent\n\n- Keep every line\n- Preserve Markdown";
    await replaceUserInstructions(content, instructionsPath);
    const config = {
      userProfile: {
        name: "Spencer",
        responsePreference: "balanced",
        customInstructions: "legacy value must not win",
      },
    } as Config;

    invalidatePromptCache();
    const newPrompt = await generateSystemPrompt("AGENT", projectDir, config, {
      sessionId: "new-session",
      userInstructionsPath: instructionsPath,
    });
    const resumedPrompt = await generateSystemPrompt("AGENT", projectDir, config, {
      sessionId: "resumed-session",
      userInstructionsPath: instructionsPath,
    });

    for (const prompt of [newPrompt, resumedPrompt]) {
      const messages = buildChatMessages([], prompt);
      expect(messages[0]?.role).toBe("system");
      expect(messages[0]?.content).toContain(content);
      expect(messages[0]?.content).not.toContain("legacy value must not win");
    }

    const explorePrompt = await generateSystemPrompt("ASK", projectDir, config, {
      sessionId: "explore-session",
      userInstructionsPath: instructionsPath,
    });
    expect(explorePrompt).toContain(content);
    expect(explorePrompt).not.toContain("Use user_instructions");
  });
});
