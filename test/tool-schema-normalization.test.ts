import { describe, expect, test } from "bun:test";
import { Tool } from "../src/tools/registry.js";
import "../src/tools/init.js";

type JsonSchema = Record<string, unknown>;

/**
 * Collect every boolean `exclusiveMinimum` / `exclusiveMaximum` in a schema.
 *
 * Draft-04 encodes an exclusive bound as a boolean beside an inclusive one
 * (`{ minimum: 0, exclusiveMinimum: true }`). JSON Schema 2019-09+ requires a
 * number there, and strict function-calling validators reject the boolean form
 * by failing the entire request — not just the offending tool.
 */
function booleanExclusiveBounds(node: unknown, path = "$", hits: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((child, index) => booleanExclusiveBounds(child, `${path}[${index}]`, hits));
    return hits;
  }
  if (typeof node !== "object" || node === null) return hits;

  for (const [key, value] of Object.entries(node)) {
    if (
      (key === "exclusiveMinimum" || key === "exclusiveMaximum") &&
      typeof value === "boolean"
    ) {
      hits.push(`${path}.${key}`);
    }
    booleanExclusiveBounds(value, `${path}.${key}`, hits);
  }
  return hits;
}

function parametersFor(toolName: string): JsonSchema {
  const definition = Tool.getAPIDefinitions().find((d) => d.function.name === toolName);
  if (!definition) throw new Error(`Tool not registered: ${toolName}`);
  return definition.function.parameters as JsonSchema;
}

function propertyOf(toolName: string, property: string): JsonSchema {
  const properties = parametersFor(toolName).properties as JsonSchema | undefined;
  const value = properties?.[property];
  if (typeof value !== "object" || value === null) {
    throw new Error(`${toolName}.${property} is not an object schema`);
  }
  return value as JsonSchema;
}

describe("tool schema exclusive bounds", () => {
  test("no registered tool emits a boolean exclusiveMinimum or exclusiveMaximum", () => {
    const offenders = Tool.getAPIDefinitions().flatMap((definition) =>
      booleanExclusiveBounds(definition.function.parameters, definition.function.name)
    );
    expect(offenders.join(", ")).toBe("");
  });

  test("github_issue.number carries a numeric exclusive bound", () => {
    const number = propertyOf("github_issue", "number");
    expect(number.type).toBe("integer");
    expect(number.exclusiveMinimum).toBe(0);
    expect("minimum" in number).toBe(false);
  });

  test("semantic_search.maxResults carries a numeric exclusive bound", () => {
    const maxResults = propertyOf("semantic_search", "maxResults");
    expect(maxResults.exclusiveMinimum).toBe(0);
    expect(maxResults.maximum).toBe(20);
  });

  test("mode-filtered definitions normalize on the same path as the full set", () => {
    const offenders = Tool.getAPIDefinitionsForMode("AGENT").flatMap((definition) =>
      booleanExclusiveBounds(definition.function.parameters, definition.function.name)
    );
    expect(offenders.join(", ")).toBe("");
  });
});
