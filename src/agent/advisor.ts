/**
 * Advisor module — strategic advisor/executor orchestration.
 *
 * Handles building the advisor prompt, making API calls, validating plan output,
 * and saving structured plan files to .impulse/advisor-plans/.
 */

import type { ChatMessage } from "../api/types";
import { getProviderManager } from "../api/manager";
import type { LoopEvents } from "./loop.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ── Constants ───────────────────────────────────────────────────────────────

const PLAN_REQUIRED_SECTIONS = [
  "## Goals",
  "## Approach",
  "## Task List",
  "## Dependencies",
  "## Risks",
  "## Assumptions",
  "## Executor must verify",
  "## Self-Check",
];

/** Max plan markdown embedded in consult_advisor tool JSON for the executor. */
export const PLAN_MARKDOWN_MAX_CHARS = 12_000;

export interface AdvisorResult {
  success: boolean;
  summary: string;
  planPath?: string;
  planMarkdown?: string;
  advisorModel: string;
  selfCheckPassed: boolean;
  error?: string;
}

export interface AdvisorCallParams {
  advisorModel: string;
  fullSystemPrompt: string;
  toolDefinitions: Array<{ type: string; function: { name: string; description: string } }>;
  fullHistory: ChatMessage[];
  topic: string;
  context: string;
  callType: "plan" | "advisory";
  events: LoopEvents;
  signal: AbortSignal;
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function runAdvisorConsultation(params: AdvisorCallParams): Promise<AdvisorResult> {
  const { advisorModel, fullSystemPrompt, toolDefinitions, fullHistory, topic, context, callType, events, signal } = params;

  try {
    const manager = await getProviderManager();
    events.onAdvisorStart(advisorModel);

    const prompt = buildAdvisorPrompt(fullSystemPrompt, toolDefinitions, fullHistory, topic, context, callType);

    const advisorMessages: ChatMessage[] = [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ];

    let advisorResponse = "";
    for await (const chunk of manager.stream({
      model: advisorModel,
      messages: advisorMessages,
      stream: true,
      signal,
    })) {
      if (signal.aborted) break;
      const text = chunk.choices[0]?.delta?.content ?? "";
      if (text) {
        advisorResponse += text;
        events.onAdvisorToken(text);
      }
    }

    if (signal.aborted) {
      events.onAdvisorEnd("(aborted)");
      return { success: false, summary: "Aborted by user", advisorModel, selfCheckPassed: false, error: "aborted" };
    }

    // Validate plan structure
    const validation = validatePlanStructure(advisorResponse, callType);
    if (!validation.passed) {
      // One automatic retry with fix instruction
      const retryMessages: ChatMessage[] = [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
        { role: "assistant", content: advisorResponse },
        { role: "user", content: `Your previous output is missing required sections: ${validation.missing.join(", ")}. Please regenerate with ALL required sections.` },
      ];

      advisorResponse = "";
      for await (const chunk of manager.stream({
        model: advisorModel,
        messages: retryMessages,
        stream: true,
        signal,
      })) {
        if (signal.aborted) break;
        const text = chunk.choices[0]?.delta?.content ?? "";
        if (text) advisorResponse += text;
      }

      const retryValidation = validatePlanStructure(advisorResponse, callType);
      if (!retryValidation.passed) {
        events.onAdvisorEnd(advisorResponse || "(validation failed)");
        return {
          success: false,
          summary: "Plan validation failed — missing required sections",
          advisorModel,
          selfCheckPassed: false,
          error: `Missing: ${retryValidation.missing.join(", ")}`,
        };
      }
    }

    // Save plan file
    const planPath = savePlanFile(advisorResponse, advisorModel, topic, callType);

    // Extract summary (first paragraph after the header)
    const summary = extractSummary(advisorResponse);

    events.onAdvisorEnd(advisorResponse || "(no advisor response)");
    const planMarkdown = advisorResponse.slice(0, PLAN_MARKDOWN_MAX_CHARS);
    return {
      success: true,
      summary,
      planPath,
      planMarkdown,
      advisorModel,
      selfCheckPassed: true,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    events.onAdvisorEnd(`(advisor error: ${errMsg})`);
    return { success: false, summary: errMsg, advisorModel, selfCheckPassed: false, error: errMsg };
  }
}

// ── Prompt Building ─────────────────────────────────────────────────────────

interface AdvisorPrompt {
  system: string;
  user: string;
}

function buildAdvisorPrompt(
  fullSystemPrompt: string,
  toolDefinitions: Array<{ type: string; function: { name: string; description: string } }>,
  fullHistory: ChatMessage[],
  topic: string,
  context: string,
  callType: "plan" | "advisory",
): AdvisorPrompt {
  const toolList = toolDefinitions
    .map((t) => `- ${t.function.name}: ${t.function.description}`)
    .join("\n");

  const historySummary = fullHistory
    .map((m) => {
      const raw =
        typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `[${m.role}]: ${raw.slice(0, 4000)}`;
    })
    .join("\n\n");

  const system = `${fullSystemPrompt}

## Advisor Role
You are a STRATEGIC ADVISOR for an AI coding agent (the "executor"). You do not write code or read the repo.
Your output is hypotheses and checklists — NOT ground truth. Do not invent file paths; say "executor should verify X exists."

You produce ${callType === "plan" ? "architectural plans" : "course corrections"} in structured Markdown.

The executor has access to these tools:
${toolList}

The executor is working in this directory: ${process.cwd()}`;

  const user = `# Advisor Request: ${topic}
**Type:** ${callType === "plan" ? "Strategic Plan" : "Course Correction Advisory"}

## Full Conversation History
${historySummary}

## Executor's Question / Context
${context}

## Instructions
The executor may include an **Executor draft** in the context below — your initial approach or plan sketch.
Critique that draft objectively. Do not rubber-stamp it. Note disagreements in **Assumptions** and **Risks**.

Produce a structured Markdown document with ALL of these sections:

## Goals
- Bulleted list of what needs to be accomplished

## Approach
- Strategic direction, architectural decisions, key patterns

## Task List
- [ ] Actionable task with description

## Dependencies
- What the executor needs to be aware of

## Risks
- Potential issues and mitigation strategies

## Assumptions
- What you are assuming (may be wrong — executor must verify)

## Executor must verify
- Concrete steps: files to read, commands to run, tests (cwd-relative paths only)

## Self-Check
- [ ] All required sections present
- [ ] Task list is actionable (each task has a clear description)
- [ ] Dependencies identified
- [ ] Risks assessed
- [ ] Unverified assumptions listed
- [ ] Executor verification steps listed

Keep the response focused and actionable. The executor will read this file, verify, then act.`;

  return { system, user };
}

// ── Plan Validation ─────────────────────────────────────────────────────────

interface ValidationResult {
  passed: boolean;
  missing: string[];
}

function validatePlanStructure(text: string, _callType: "plan" | "advisory"): ValidationResult {
  const missing: string[] = [];

  for (const section of PLAN_REQUIRED_SECTIONS) {
    if (!text.includes(section)) {
      missing.push(section);
    }
  }

  if (text.includes("## Self-Check")) {
    const selfCheckSection = text.split("## Self-Check")[1]?.split("##")[0] ?? "";
    if (!selfCheckSection.includes("- [")) {
      missing.push("Self-Check checkboxes");
    }
  }

  const assumptions = text.split("## Assumptions")[1]?.split("##")[0]?.trim() ?? "";
  if (assumptions.length < 8) {
    missing.push("Assumptions content");
  }

  const verify = text.split("## Executor must verify")[1]?.split("##")[0]?.trim() ?? "";
  if (verify.length < 8) {
    missing.push("Executor must verify content");
  }

  return { passed: missing.length === 0, missing };
}

// ── File Saving ─────────────────────────────────────────────────────────────

function savePlanFile(
  content: string,
  advisorModel: string,
  topic: string,
  callType: "plan" | "advisory",
): string {
  const homeDir = os.homedir();
  const plansDir = path.join(homeDir, ".impulse", "advisor-plans");
  if (!fs.existsSync(plansDir)) {
    fs.mkdirSync(plansDir, { recursive: true });
  }

  // Sanitize topic for filename
  const safeTopic = topic
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `${callType}-${safeTopic}-${timestamp}.md`;
  const filePath = path.join(plansDir, filename);

  // Prepend metadata header
  const header = `# Advisor ${callType === "plan" ? "Plan" : "Advisory"}: ${topic}\n**Date:** ${new Date().toISOString().slice(0, 19).replace("T", " ")}\n**Advisor:** ${advisorModel}\n**Type:** ${callType}\n\n`;
  fs.writeFileSync(filePath, header + content, { mode: 0o600 });

  return filePath;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractSummary(text: string): string {
  // Get first meaningful paragraph after the header
  const afterHeader = text.split("## Goals")[1]?.trim() ?? text;
  const firstLine = afterHeader.split("\n")[0]?.replace(/^[-*]\s*/, "")?.trim() ?? "";
  if (firstLine.length > 0) return firstLine.slice(0, 200);
  return text.slice(0, 200).replace(/[#*\n]/g, " ").trim();
}
