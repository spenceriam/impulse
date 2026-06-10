import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  collapseValidationLines,
  formatValidationError,
} from "../src/tools/input-repair/format-error.js";

describe("format-error collapse", () => {
  test("collapses repeated array-index issues", () => {
    const lines = Array.from(
      { length: 9 },
      (_, i) => `questions.${i}.options.0.description: expected string, received undefined`
    );
    const collapsed = collapseValidationLines(lines);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toContain("questions[*].options[*].description");
    expect(collapsed[0]).toContain("(9 occurrences)");
  });

  test("caps total lines at 6 with overflow marker", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `field${i}: invalid value`);
    const collapsed = collapseValidationLines(lines);
    expect(collapsed).toHaveLength(7);
    expect(collapsed[6]).toBe("(+4 more)");
  });

  test("formatValidationError uses collapse for question schema", () => {
    const schema = z.object({
      questions: z.array(
        z.object({
          options: z.array(z.object({ description: z.string() })),
        })
      ),
    });

    const input = {
      questions: Array.from({ length: 5 }, () => ({
        options: [{ label: "a" }],
      })),
    };

    const parsed = schema.safeParse(input);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const msg = formatValidationError(parsed.error, "question", input);
      expect(msg).toContain("(5 occurrences)");
      expect(msg.split("\n").length).toBeLessThanOrEqual(3);
    }
  });
});
