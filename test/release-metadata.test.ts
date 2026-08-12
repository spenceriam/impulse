import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";

describe("release metadata", () => {
  test("keeps source, contribution, and generated package licenses on AGPL-3.0", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as { license?: string };
    const contributing = readFileSync(
      new URL("../CONTRIBUTING.md", import.meta.url),
      "utf8"
    );
    const releaseWorkflow = readFileSync(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8"
    );
    const wrapperPackage = JSON.parse(
      readFileSync(new URL("../packages/cli/package.json", import.meta.url), "utf8")
    ) as { version?: string; license?: string; optionalDependencies?: Record<string, string> };
    const packagingScripts = ["publish-linux.ts", "build-binaries.ts"].map((name) =>
      readFileSync(new URL(`../scripts/${name}`, import.meta.url), "utf8")
    );

    expect(packageJson.license).toBe("AGPL-3.0");
    expect(contributing).toContain("AGPL-3.0 License");
    expect(contributing).not.toContain("MIT License");
    expect(releaseWorkflow).toContain('"license": "AGPL-3.0"');
    expect(releaseWorkflow).not.toContain('"license": "MIT"');
    expect(wrapperPackage.version).toBe("1.10.0");
    expect(wrapperPackage.license).toBe("AGPL-3.0");
    expect(new Set(Object.values(wrapperPackage.optionalDependencies ?? {}))).toEqual(
      new Set(["1.10.0"])
    );
    for (const script of packagingScripts) {
      expect(script).toContain('license: "AGPL-3.0"');
      expect(script).not.toContain('license: "MIT"');
    }
  });
});
