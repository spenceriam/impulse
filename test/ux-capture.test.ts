import { describe, expect, test } from "bun:test";
import {
  CAPTURE_WIDTHS,
  UX_CAPTURE_ARTIFACT_FILES,
  UX_CAPTURE_SCENARIOS,
  renderUxCapture,
  serializeUxCaptureArtifacts,
} from "../src/cli/ux-capture.js";
import { stripAnsiAndMarkers } from "./helpers/gutter-assertions.js";
import packageJson from "../package.json";

describe("UX capture scenario registry", () => {
  test("registers the deterministic Gauntlet surfaces at the required widths", () => {
    expect(CAPTURE_WIDTHS).toEqual([60, 80, 120]);
    expect(UX_CAPTURE_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      "conversation-compact",
      "conversation-comfy",
      "thinking-tools-compact",
      "thinking-tools-comfy",
      "permission",
      "allow-all-disclaimer",
      "question",
      "execution-handoff",
      "preview-review",
      "help",
      "slash-autocomplete",
      "skills-compact",
      "skills-comfy",
      "plan-settings-compact",
      "plan-settings-comfy",
      "context-bar-ask",
      "context-bar-agent",
    ]);
  });

  test("renders every scenario at 60, 80, and 120 columns", () => {
    const capture = renderUxCapture();

    expect(capture.map((entry) => entry.width)).toEqual([60, 80, 120]);
    for (const entry of capture) {
      expect(entry.scenarios.map((scenario) => scenario.id)).toEqual(
        UX_CAPTURE_SCENARIOS.map((scenario) => scenario.id)
      );
      expect(entry.scenarios.every((scenario) => scenario.lines.length > 0)).toBe(true);
    }
  });

  test("never overflows the requested terminal width after ANSI and markers are stripped", () => {
    for (const entry of renderUxCapture()) {
      for (const scenario of entry.scenarios) {
        for (const line of scenario.lines) {
          expect(
            stripAnsiAndMarkers(line).length,
            `${scenario.id} overflowed at ${entry.width} columns: ${stripAnsiAndMarkers(line)}`
          ).toBeLessThanOrEqual(entry.width);
        }
      }
    }
  });

  test("is repeatable and contains representative production labels", () => {
    const first = renderUxCapture();
    const second = renderUxCapture();
    expect(second).toEqual(first);

    const text = first
      .flatMap((entry) => entry.scenarios.flatMap((scenario) => scenario.lines))
      .map(stripAnsiAndMarkers)
      .join("\n");

    for (const label of [
      "you",
      "impulse",
      "Surface",
      "Content after the table",
      "- list after the table",
      "const capture = true",
      "Thinking:",
      "Thought for 2.4s",
      "read src/cli/renderer.ts",
      "file_edit",
      "bash bun test",
      "task (SCOUT)",
      "Permission required",
      "Allow all permissions",
      "Need your input",
      "Execution handoff",
      "Preview safely (recommended)",
      "Safe preview ready",
      "PREVIEW · bubblewrap · network off",
      "Help",
      "Commands",
      "Plan ready",
      "Settings",
      "gpt-5",
      "ASK",
      "AGENT",
      "HOST",
      "PROMPT",
    ]) {
      expect(text, `missing representative capture label: ${label}`).toContain(label);
    }
  });

  test("captures slash and skills discovery without promoting dynamic skills", () => {
    const capture = renderUxCapture([80])[0]!;
    const slash = capture.scenarios.find((scenario) => scenario.id === "slash-autocomplete")!;
    const skills = capture.scenarios.find((scenario) => scenario.id === "skills-comfy")!;
    const slashText = slash.lines.map(stripAnsiAndMarkers).join("\n");
    const skillsText = skills.lines.map(stripAnsiAndMarkers).join("\n");

    expect(slashText).toContain("/skills");
    expect(slashText).not.toContain("/skill ");
    expect(slashText).toContain("list installed skills");
    expect(slashText).not.toContain("grill-with-docs");
    expect(slashText).not.toContain("/grill");

    for (const label of [
      "Skills · 2 installed",
      "grill-with-docs",
      "release-check",
      "Skill: grill-with-docs",
      "Use skill",
      "Inspect instructions",
      "Modify skill",
      "Remove skill",
    ]) {
      expect(skillsText, `missing skills discovery label: ${label}`).toContain(label);
    }
  });

  test("captures compact and comfy density as the same semantics with different spacing", () => {
    const scenarios = renderUxCapture([80])[0]!.scenarios;
    for (const prefix of ["conversation", "thinking-tools", "skills", "plan-settings"]) {
      const compact = scenarios.find((scenario) => scenario.id === `${prefix}-compact`)!;
      const comfy = scenarios.find((scenario) => scenario.id === `${prefix}-comfy`)!;
      expect(compact.lines.length).toBeLessThanOrEqual(comfy.lines.length);
    }
  });

  test("captures ASK and AGENT authority at 60 columns", () => {
    const scenarios = renderUxCapture([60])[0]!.scenarios;
    const ask = scenarios.find((scenario) => scenario.id === "context-bar-ask")!;
    const agent = scenarios.find((scenario) => scenario.id === "context-bar-agent")!;
    expect(ask.lines.map(stripAnsiAndMarkers).join("\n")).toContain("ASK");
    expect(agent.lines.map(stripAnsiAndMarkers).join("\n")).toContain("AGENT");
  });

  test("keeps the production user label and prompt free of mode-colored accent chrome", () => {
    const conversation = renderUxCapture([80])[0]!.scenarios.find(
      (scenario) => scenario.id === "conversation-compact"
    )!;
    const labelIndex = conversation.lines.findIndex(
      (line) => stripAnsiAndMarkers(line).trim() === "you"
    );
    expect(labelIndex).toBeGreaterThanOrEqual(0);
    expect(conversation.lines[labelIndex]).toContain("\x1b[36m");
    expect(stripAnsiAndMarkers(conversation.lines[labelIndex]!)).not.toContain("┃");
    expect(conversation.lines[labelIndex + 1]).not.toContain("\x1b[32m");
    expect(conversation.lines[labelIndex + 1]).not.toContain("\x1b[34m");
  });

  test("serializes inspectable HTML plus ANSI and plain-text evidence", () => {
    const artifacts = serializeUxCaptureArtifacts(renderUxCapture());

    expect(UX_CAPTURE_ARTIFACT_FILES).toEqual({
      html: "impulse-ux-capture.html",
      ansi: "impulse-ux-capture.ansi",
      plain: "impulse-ux-capture.txt",
    });
    expect(artifacts.html).toContain('data-terminal-columns="60"');
    expect(artifacts.html).toContain('data-terminal-columns="80"');
    expect(artifacts.html).toContain('data-terminal-columns="120"');
    expect(artifacts.html).toContain('data-scenario="conversation-compact"');
    expect(artifacts.html).not.toContain("\x1b[");
    expect(artifacts.ansi).toContain("\x1b[");
    expect(artifacts.ansi).toContain("@@ width=60");
    expect(artifacts.plain).not.toContain("\x1b[");
    expect(artifacts.plain).toContain("@@ scenario=thinking-tools-compact");
  });

  test("exposes one discoverable Bun capture command", () => {
    expect(packageJson.scripts["gauntlet:capture"]).toBe(
      "bun run src/cli/ux-capture.ts"
    );
  });
});
