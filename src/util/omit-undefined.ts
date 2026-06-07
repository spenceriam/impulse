/**
 * Strip undefined values so objects satisfy exactOptionalPropertyTypes.
 */
export function omitUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as (keyof T)[]) {
    const value = obj[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/** Patch type that allows explicit `undefined` to clear optional fields. */
export type OptionalPatch<T> = {
  [K in keyof T]?: T[K] | undefined;
};

/** Merge patch into base; `undefined` values delete optional keys. */
export function applyOptionalPatch<T extends object>(base: T, patch: OptionalPatch<T>): T {
  const next = { ...base } as T;
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const val = patch[key];
    if (val === undefined) {
      delete (next as Record<string, unknown>)[key as string];
    } else {
      (next as Record<string, unknown>)[key as string] = val;
    }
  }
  return next;
}
