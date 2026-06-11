import { describe, expect, test } from "bun:test";
import { z } from "zod";

const QuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
});

describe("question option schema", () => {
  test("accepts options without description", () => {
    const parsed = QuestionOptionSchema.safeParse({ label: "React" });
    expect(parsed.success).toBe(true);
  });

  test("accepts options with description", () => {
    const parsed = QuestionOptionSchema.safeParse({
      label: "React",
      description: "Component-based UI",
    });
    expect(parsed.success).toBe(true);
  });
});
