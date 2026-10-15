import { describe, expect, test } from "bun:test";
import { classifyCommand, needsPermission, bashGrantScope } from "../src/tools/bash.js";

describe("bash permission policy", () => {
  test("unknown commands no longer require approval by default (#142)", () => {
    expect(classifyCommand("mystery-cli --foo")).toBe("unknown");
    expect(needsPermission("mystery-cli --foo").needed).toBe(false);
  });

  test("safe read-only commands within cwd do not require approval", () => {
    expect(needsPermission("ls -la").needed).toBe(false);
  });

  test("compound commands classify each segment", () => {
    expect(needsPermission("git status && git diff -- src").needed).toBe(false);
    expect(needsPermission("echo ok; rm -rf build").needed).toBe(true);
    // Unknown segments no longer prompt on their own (#142)
    expect(needsPermission("echo ok && mystery-cli --foo").needed).toBe(false);
  });

  test("quoted operators do not make a command compound", () => {
    expect(needsPermission('echo "a && b"').needed).toBe(false);
    expect(needsPermission("Select-String 'a || b' file.txt").needed).toBe(false);
  });

  test("redirection requires approval", () => {
    expect(needsPermission("echo data > file.txt").needed).toBe(true);
  });

  test("reads outside cwd are allowed (#142)", () => {
    expect(needsPermission("cat /etc/hosts").needed).toBe(false);
    expect(needsPermission("grep -rn needle /var/log").needed).toBe(false);
    expect(needsPermission("ls /tmp").needed).toBe(false);
  });

  test("directory changes outside cwd never prompt (#142)", () => {
    expect(needsPermission("cd /tmp").needed).toBe(false);
    expect(needsPermission("cd /var/log && ls").needed).toBe(false);
  });

  test("writes outside cwd still require approval (#142)", () => {
    expect(needsPermission("echo data > /tmp/file.txt").needed).toBe(true);
    expect(needsPermission("cp src/a.ts /tmp/a.ts").needed).toBe(true);
    expect(needsPermission("git clone https://example.com/x /tmp/x").needed).toBe(true);
    expect(needsPermission("sed -i s/a/b/ /tmp/file").needed).toBe(true);
  });

  test("unknown command with outside path but no write indicator passes (#142)", () => {
    expect(needsPermission("mystery-cli /tmp/out").needed).toBe(false);
  });
});

describe("bash session-grant scopes (#170)", () => {
  test("write-ish commands scope to the target directory", () => {
    expect(bashGrantScope('echo x > /tmp/impulse-permission-test.txt')).toBe("write:/tmp");
    expect(bashGrantScope("cp src/a.ts /tmp/a.ts")).toBe("write:/tmp");
    expect(bashGrantScope("sed -i s/a/b/ ./src/cli/x.ts")).toBe(
      `write:${process.cwd()}/src/cli`
    );
  });

  test("high-risk commands keep exact-command grants", () => {
    expect(bashGrantScope("rm -rf build")).toBe("rm -rf build");
    expect(bashGrantScope("git push origin main")).toBe("git push origin main");
  });

  test("non-write and path-less commands keep exact-command grants", () => {
    expect(bashGrantScope("echo data > file.txt")).toBe(`write:${process.cwd()}`);
    expect(bashGrantScope("mystery-cli --foo")).toBe("mystery-cli --foo");
  });
});
