import { describe, expect, test } from "bun:test";
import "../src/tools/init";
import { Tool } from "../src/tools/registry";

describe("web research tools", () => {
  test("registers web_search and web_fetch as read-only tools", () => {
    const exploreDefs = Tool.getAPIDefinitionsForMode("EXPLORE");
    const names = exploreDefs.map((def) => def.function.name);

    expect(names).toContain("web_search");
    expect(names).toContain("web_fetch");
  });

  test("does not expose legacy mcp_discover", () => {
    const workDefs = Tool.getAPIDefinitionsForMode("WORK");
    const names = workDefs.map((def) => def.function.name);

    expect(names).not.toContain("mcp_discover");
  });
});
