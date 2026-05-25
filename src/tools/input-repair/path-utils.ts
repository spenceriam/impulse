/**
 * Get a nested value from an object/array by path segments.
 */
export function getAtPath(root: unknown, path: (string | number)[]): unknown {
  let current = root;
  for (const segment of path) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

/**
 * Set a nested value on an object/array clone by path segments.
 */
export function setAtPath(
  root: unknown,
  path: (string | number)[],
  value: unknown
): void {
  if (path.length === 0) return;

  let current = root;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i]!;
    if (current === null || current === undefined || typeof current !== "object") {
      return;
    }
    current = (current as Record<string | number, unknown>)[segment];
  }

  const last = path[path.length - 1]!;
  if (current !== null && current !== undefined && typeof current === "object") {
    (current as Record<string | number, unknown>)[last] = value;
  }
}

/**
 * Delete a nested key from an object by path segments.
 */
export function deleteAtPath(root: unknown, path: (string | number)[]): void {
  if (path.length === 0) return;

  let current = root;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i]!;
    if (current === null || current === undefined || typeof current !== "object") {
      return;
    }
    current = (current as Record<string | number, unknown>)[segment];
  }

  const last = path[path.length - 1]!;
  if (current !== null && current !== undefined && typeof current === "object") {
    delete (current as Record<string | number, unknown>)[last];
  }
}

/**
 * Deep-clone input for safe in-place repair without mutating the model's raw payload.
 */
export function cloneInput(input: unknown): unknown {
  if (input === undefined) return input;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(input);
    } catch {
      // Fall through to JSON clone for non-cloneable values.
    }
  }
  return JSON.parse(JSON.stringify(input));
}
