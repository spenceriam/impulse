import { describe, expect, test } from "bun:test";
import {
  PreviewApplyController,
  USER_PREVIEW_APPLY_AUTHORITY,
} from "../src/preview/apply-controller.js";

describe("explicit preview apply authority", () => {
  test("rejects replay/synthetic authority and applies only between visible AGENT then ASK", async () => {
    const order: string[] = [];
    const controller = new PreviewApplyController({
      checkApply: async () => ({ ok: true, changedFiles: ["app.ts"] }),
      apply: async () => { order.push("apply"); return { ok: true, status: "applied", changedFiles: ["app.ts"] }; },
      transition: async (mode) => { order.push(mode); return true; },
    });
    expect((await controller.apply("p1", Symbol("model"))).ok).toBe(false);
    expect(order).toEqual([]);
    expect((await controller.apply("p1", USER_PREVIEW_APPLY_AUTHORITY)).ok).toBe(true);
    expect(order).toEqual(["AGENT", "apply", "ASK"]);
    expect((await controller.apply("p1", USER_PREVIEW_APPLY_AUTHORITY)).ok).toBe(false);
  });

  test("checks conflicts before elevation and remains truthful after unsafe rollback", async () => {
    const transitions: string[] = [];
    const conflict = new PreviewApplyController({
      checkApply: async () => ({ ok: false, status: "conflict", notice: "changed", safeToReturnToAsk: true }),
      apply: async () => { throw new Error("must not apply"); },
      transition: async (mode) => { transitions.push(mode); return true; },
    });
    expect(await conflict.apply("p2", USER_PREVIEW_APPLY_AUTHORITY)).toMatchObject({ ok: false, status: "conflict" });
    expect(transitions).toEqual([]);

    const unsafe = new PreviewApplyController({
      checkApply: async () => ({ ok: true, changedFiles: ["app.ts"] }),
      apply: async () => ({ ok: false, status: "rollback", notice: "rollback incomplete", safeToReturnToAsk: false }),
      transition: async (mode) => { transitions.push(mode); return true; },
    });
    expect(await unsafe.apply("p3", USER_PREVIEW_APPLY_AUTHORITY)).toMatchObject({ ok: false, remainsAgent: true });
    expect(transitions).toEqual(["AGENT"]);
  });
});
