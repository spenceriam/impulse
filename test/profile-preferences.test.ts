import { describe, expect, test } from "bun:test";
import { formatUserCollaborationProfile } from "../src/agent/prompts.js";
import { buildChatMessages } from "../src/agent/build-chat-messages.js";
import { buildSideSystemPrompt } from "../src/agent/side-chat.js";

describe("formatUserCollaborationProfile", () => {
  test("compiles balanced preference into behavioral instructions", () => {
    const block = formatUserCollaborationProfile({
      name: "Spencer",
      responsePreference: "balanced",
      customInstructions: "",
    });

    expect(block).toContain("Name: Spencer");
    expect(block).toContain("Style: balanced");
    expect(block).toContain("Proceed with safe implementation work");
  });

  test("keeps custom instructions in the profile block", () => {
    const block = formatUserCollaborationProfile({
      name: "",
      responsePreference: "technical",
      customInstructions: "Prefer exact file names.",
    }, {
      content: "# Persistent\n\nPrefer exact file names.",
      source: "file",
      sourceLabel: "~/.impulse/user-instructions.md",
      fingerprint: "test-fingerprint",
    });

    expect(block).toContain("Style: technical");
    expect(block).toContain("Persistent instructions source: ~/.impulse/user-instructions.md");
    expect(block).toContain("The Impulse host already loaded these instructions");
    expect(block).toContain("# Persistent\n\nPrefer exact file names.");
  });

  test("places the effective instructions in the provider system message", () => {
    const block = formatUserCollaborationProfile({
      name: "",
      responsePreference: "balanced",
      customInstructions: "",
    }, {
      content: "# Complete document\n\n- Keep every line\n- Preserve Markdown",
      source: "file",
      sourceLabel: "~/.impulse/user-instructions.md",
      fingerprint: "provider-test",
    });

    const messages = buildChatMessages([], block ?? "");
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain(
      "# Complete document\n\n- Keep every line\n- Preserve Markdown"
    );
    expect(messages[0]?.content).not.toContain("apiKey");
  });

  test("does not trim intentional instruction boundary whitespace", () => {
    const block = formatUserCollaborationProfile(undefined, {
      content: "\n    indented Markdown\n\n",
      source: "file",
      sourceLabel: "~/.impulse/user-instructions.md",
      fingerprint: "whitespace-test",
    });

    expect(block).toContain("Custom instructions:\n\n    indented Markdown\n\n");
  });

  test("places instructions in side chats without advertising unavailable tools", () => {
    const profile = formatUserCollaborationProfile(undefined, {
      content: "Answer with the decision first.",
      source: "file",
      sourceLabel: "~/.impulse/user-instructions.md",
      fingerprint: "side-test",
    }, { instructionToolAvailable: false });
    const systemPrompt = buildSideSystemPrompt(profile);

    expect(systemPrompt).toContain("Answer with the decision first.");
    expect(systemPrompt).not.toContain("Use user_instructions");
  });
});
