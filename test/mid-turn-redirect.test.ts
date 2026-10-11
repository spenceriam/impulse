import { describe, expect, test } from "bun:test";
import { AgentLoop } from "../src/agent/loop.js";
import { formatSteeringNote } from "../src/agent/steer-injection.js";
import { buildQueuePreviewText } from "../src/cli/queue-preview.js";
import type { PromptSubmitPayload } from "../src/cli/prompt-input.js";
import { BUSY_STEERING } from "../src/cli/busy-status.js";

function payload(text: string): PromptSubmitPayload {
  return {
    apiText: text,
    displayMessage: text,
    orderedImages: [],
    segments: [{ kind: "text", value: text }],
  };
}

describe("mid-turn redirect / steer replace", () => {
  test("setSteer replaces pending (latest wins)", () => {
    const loop = new AgentLoop();
    loop.setSteer("first instruction");
    expect(loop.getPendingSteer()).toBe("first instruction");
    loop.setSteer("second instruction");
    expect(loop.getPendingSteer()).toBe("second instruction");
    expect(loop.getPendingSteer()).not.toBe("first instruction");
  });

  test("setSteer trims whitespace", () => {
    const loop = new AgentLoop();
    loop.setSteer("  hold on  ");
    expect(loop.getPendingSteer()).toBe("hold on");
  });

  test("steering note format unchanged for redirect path", () => {
    const note = formatSteeringNote("use ls instead");
    expect(note).toContain("overrides prior instructions");
    expect(note).toContain("use ls instead");
  });

  test("queue preview shows Steering… affordance distinct from Queued", () => {
    const steeringOnly = buildQueuePreviewText({
      items: [],
      holdDrain: false,
      editIndex: 0,
      width: 80,
      steeringText: "stop and summarize",
    });
    expect(steeringOnly).toContain("Steering…");
    expect(steeringOnly).toContain("stop and summarize");
    expect(steeringOnly).not.toContain("Queued messages");

    const queued = buildQueuePreviewText({
      items: [payload("after this turn")],
      holdDrain: false,
      editIndex: 0,
      width: 80,
    });
    expect(queued).toContain("Queued messages");
    expect(queued).not.toContain("Steering…");

    const both = buildQueuePreviewText({
      items: [payload("later")],
      holdDrain: false,
      editIndex: 0,
      width: 80,
      steeringText: "redirect now",
    });
    expect(both).toContain("Steering…");
    expect(both).toContain("Queued messages");
  });

  test("BUSY_STEERING chrome phrase is clear", () => {
    expect(BUSY_STEERING).toBe("Steering…");
  });
});
