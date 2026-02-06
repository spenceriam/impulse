import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CommandRegistry } from "../src/commands/registry";

describe("CommandRegistry.list", () => {
  beforeEach(() => {
    CommandRegistry.clear();
  });

  afterEach(() => {
    CommandRegistry.clear();
  });

  it("returns each command once when aliases exist", () => {
    CommandRegistry.register({
      name: "think",
      category: "utility",
      description: "Toggle thinking mode",
      handler: async () => ({ success: true }),
    });

    CommandRegistry.register({
      name: "thinking-blocks",
      aliases: ["toggle-thinking-blocks", "thinking"],
      category: "utility",
      description: "Toggle thinking block visibility",
      handler: async () => ({ success: true }),
    });

    expect(CommandRegistry.list().map((cmd) => cmd.name)).toEqual([
      "think",
      "thinking-blocks",
    ]);
  });

  it("keeps hidden filtering and category filtering after de-duplication", () => {
    CommandRegistry.register({
      name: "help",
      aliases: ["h"],
      category: "info",
      description: "Show help",
      hidden: true,
      handler: async () => ({ success: true }),
    });

    CommandRegistry.register({
      name: "mode",
      category: "utility",
      description: "Switch mode",
      handler: async () => ({ success: true }),
    });

    expect(CommandRegistry.list().map((cmd) => cmd.name)).toEqual(["mode"]);
    expect(CommandRegistry.list(undefined, true).map((cmd) => cmd.name)).toEqual(["help", "mode"]);
    expect(CommandRegistry.list("info", true).map((cmd) => cmd.name)).toEqual(["help"]);
  });
});
