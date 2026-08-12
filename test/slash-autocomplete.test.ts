import { describe, expect, test } from "bun:test";
import {
  completeSlashCommandTab,
  shouldShowSlashAutocomplete,
} from "../src/cli/slash-autocomplete.js";

const COMMANDS = [
  { cmd: "/show", hint: "restore chat" },
  { cmd: "/show-think", hint: "expand thinking" },
  { cmd: "/hide-think", hint: "collapse thinking" },
  { cmd: "/settings", hint: "settings" },
];

describe("shouldShowSlashAutocomplete", () => {
  test("lists extension commands when token is an exact shorter match", () => {
    const result = shouldShowSlashAutocomplete("/show", COMMANDS);
    expect(result.show).toBe(true);
    expect(result.matches.map((m) => m.cmd)).toEqual(["/show-think"]);
  });

  test("lists all prefix matches when token is partial", () => {
    const result = shouldShowSlashAutocomplete("/sho", COMMANDS);
    expect(result.show).toBe(true);
    expect(result.matches.map((m) => m.cmd).sort()).toEqual(["/show", "/show-think"]);
  });

  test("hides when token is exact and no longer extensions exist", () => {
    const result = shouldShowSlashAutocomplete("/settings", COMMANDS);
    expect(result.show).toBe(false);
  });
});

describe("completeSlashCommandTab", () => {
  test("completes unique prefix to full command", () => {
    const { text } = completeSlashCommandTab("/show-th", COMMANDS, null);
    expect(text).toBe("/show-think");
  });

  test("completes /hide to /hide-think", () => {
    const { text } = completeSlashCommandTab("/hide", COMMANDS, null);
    expect(text).toBe("/hide-think");
  });

  test("cycles /show to /show-think on Tab", () => {
    const first = completeSlashCommandTab("/show", COMMANDS, null);
    expect(first.text).toBe("/show-think");
    expect(first.nextCycle?.index).toBe(1);

    const second = completeSlashCommandTab("/show-think", COMMANDS, first.nextCycle);
    expect(second.text).toBe("/show");
    expect(second.nextCycle?.index).toBe(0);
  });

  test("extends partial /sh to /show when shared prefix", () => {
    const { text } = completeSlashCommandTab("/sh", COMMANDS, null);
    expect(text).toBe("/show");
  });
});
