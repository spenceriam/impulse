import { z } from "zod";
import { cloneInput } from "./path-utils";
import { formatValidationError } from "./format-error";
import { logRepairs } from "./observability";
import { repairNullForOptional } from "./repairs/null-optional";
import { repairStringifiedArray } from "./repairs/stringified-array";
import { repairObjectToArray } from "./repairs/object-to-array";
import { repairStringToArray } from "./repairs/string-to-array";
import { repairMarkdownPathUnwrap } from "./repairs/markdown-path";
import type {
  RepairEvent,
  RepairFn,
  ValidateToolInputOptions,
  ValidateToolInputResult,
} from "./types";

export type {
  RepairEvent,
  ValidateToolInputOptions,
  ValidateToolInputResult,
} from "./types";

/** Ordered repair pipeline — apply in this sequence only after validation fails. */
const REPAIR_PIPELINE: RepairFn[] = [
  repairNullForOptional,
  repairStringifiedArray,
  repairObjectToArray,
  repairStringToArray,
  repairMarkdownPathUnwrap,
];

/**
 * Validate tool input against a Zod schema, applying targeted repairs only on failure.
 * Valid inputs pass through completely unchanged.
 */
export function validateToolInput<T>(
  schema: z.ZodType<T>,
  input: unknown,
  options: ValidateToolInputOptions
): ValidateToolInputResult<T> {
  const firstPass = schema.safeParse(input);
  if (firstPass.success) {
    return { success: true, data: firstPass.data, repairs: [] };
  }

  const clone = cloneInput(input);
  const allRepairs: RepairEvent[] = [];
  let lastError = firstPass.error;

  for (const repair of REPAIR_PIPELINE) {
    const repairEvents = repair({
      input: clone,
      issues: lastError.issues,
      schema,
    });

    if (repairEvents.length > 0) {
      allRepairs.push(...repairEvents);
    }

    const retry = schema.safeParse(clone);
    if (retry.success) {
      void logRepairs(options.toolName, allRepairs);
      return { success: true, data: retry.data, repairs: allRepairs };
    }

    lastError = retry.error;
  }

  return {
    success: false,
    error: formatValidationError(lastError, options.toolName, clone),
  };
}
