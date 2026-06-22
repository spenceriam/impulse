import { describe, expect, test } from "bun:test";
import { formatUserCollaborationProfile } from "../src/agent/prompts.js";

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
    });

    expect(block).toContain("Style: technical");
    expect(block).toContain("Prefer exact file names.");
  });
});
