import type { z } from "zod";

/** Identifies which repair was applied at a schema path. */
export interface RepairEvent {
  name: string;
  path: (string | number)[];
}

export interface RepairContext {
  input: unknown;
  issues: z.ZodIssue[];
  schema: z.ZodTypeAny;
}

export type RepairFn = (ctx: RepairContext) => RepairEvent[];

export interface ValidateToolInputOptions {
  toolName: string;
}

export type ValidateToolInputResult<T> =
  | {
      success: true;
      data: T;
      repairs: RepairEvent[];
    }
  | {
      success: false;
      error: string;
    };
