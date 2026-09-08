import { describe, expect, test } from "bun:test";
import { commandHeads, findMissingCommandHeads, validateCommandAvailable } from "../src/tools/bash.js";

describe("command pre-flight", () => {
  test("extracts head tokens across compound commands and strips wrappers", () => {
    expect(commandHeads("git status")).toEqual(["git"]);
    expect(commandHeads("echo hi && nosuchtool run || true")).toEqual(["nosuchtool"]);
    expect(commandHeads("FOO=1 BAR=2 deploy --prod")).toEqual(["deploy"]);
    expect(commandHeads("sudo systemctl restart nginx")).toEqual(["systemctl"]);
  });

  test("skips builtins, keywords, shell syntax, and path scripts", () => {
    expect(commandHeads("for i in 1 2; do echo $i; done")).toEqual([]);
    expect(commandHeads("cd /tmp && ls -la")).toEqual([]);
    expect(commandHeads("./scripts/build.sh")).toEqual([]);
    expect(commandHeads("if [ -f x ]; then cat x; fi")).toEqual([]);
    expect(commandHeads("time git status")).toEqual(["git"]);
  });

  test("rejects unknown binaries before spawning, with the tool list", async () => {
    const message = await validateCommandAvailable(findMissingCommandHeads("definitely-not-a-real-tool run"));
    expect(message).toContain("definitely-not-a-real-tool");
    expect(message).toContain("do not guess");
    expect(message).toContain("Available tools include");
  });

  test("passes real PATH commands and mixed known/unknown compounds", async () => {
    expect(findMissingCommandHeads("git status && echo done")).toEqual([]);
    const mixed = await validateCommandAvailable(findMissingCommandHeads("git status && notarealbinary"));
    expect(mixed).toContain("notarealbinary");
  });
});
