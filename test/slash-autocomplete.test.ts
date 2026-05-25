import { describe, expect, test } from "bun:test";
import {
  shouldShowSlashAutocomplete,
  slashCommandToken,
} from "../src/cli/slash-autocomplete";

const COMMANDS = [
  { cmd: "/exit", hint: "quit" },
  { cmd: "/quit", hint: "quit" },
  { cmd: "/help", hint: "show commands" },
  { cmd: "/model", hint: "choose model" },
  { cmd: "/mode", hint: "WORK | EXPLORE" },
  { cmd: "/new", hint: "[name]  new session" },
];

describe("slashCommandToken", () => {
  test("extracts first token lowercased", () => {
    expect(slashCommandToken("/exit")).toBe("/exit");
    expect(slashCommandToken("/EXIT ")).toBe("/exit");
    expect(slashCommandToken("  /new my-session")).toBe("/new");
  });

  test("returns null when not a slash command", () => {
    expect(slashCommandToken("hello")).toBeNull();
    expect(slashCommandToken("")).toBeNull();
  });
});

describe("shouldShowSlashAutocomplete", () => {
  test("shows partial prefix /exi with /exit match", () => {
    const result = shouldShowSlashAutocomplete("/exi", COMMANDS);
    expect(result.show).toBe(true);
    expect(result.matches.some((m) => m.cmd === "/exit")).toBe(true);
  });

  test("hides on exact match /exit", () => {
    const result = shouldShowSlashAutocomplete("/exit", COMMANDS);
    expect(result.show).toBe(false);
    expect(result.matches.some((m) => m.cmd === "/exit")).toBe(true);
  });

  test("hides on exact match with trailing space", () => {
    const result = shouldShowSlashAutocomplete("/exit ", COMMANDS);
    expect(result.show).toBe(false);
  });

  test("hides on exact match with arguments", () => {
    const result = shouldShowSlashAutocomplete("/new my-session", COMMANDS);
    expect(result.show).toBe(false);
  });

  test("shows multiple prefix matches for /m", () => {
    const result = shouldShowSlashAutocomplete("/m", COMMANDS);
    expect(result.show).toBe(true);
    expect(result.matches.map((m) => m.cmd).sort()).toEqual(["/mode", "/model"]);
  });

  test("hides when input does not start with slash", () => {
    expect(shouldShowSlashAutocomplete("hello", COMMANDS).show).toBe(false);
  });

  test("hides when no commands match", () => {
    expect(shouldShowSlashAutocomplete("/unknown", COMMANDS).show).toBe(false);
    expect(shouldShowSlashAutocomplete("/unknown", COMMANDS).matches).toHaveLength(0);
  });

  test("hides on exact /quit even though /quit is also a prefix of nothing else at same length", () => {
    const result = shouldShowSlashAutocomplete("/quit", COMMANDS);
    expect(result.show).toBe(false);
  });
});
