import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import {
  buildPlanModeContextBlock,
  createPlanRevision,
  getActivePlanRevision,
  type PlanningStyle,
} from "../plan/revisions.js";
import { toRelativePlanPath } from "../plan/paths.js";
import { SessionManager } from "../session/manager.js";

const DESCRIPTION = `Create a new plan revision in PLAN mode (latest revision becomes active context).

Use when the user asks to revise or rework the plan — do not overwrite files in superseded revisions.
First revision is created automatically on first plan write if none exists.`;

const PlanRevisionSchema = z.object({
  revises: z
    .string()
    .optional()
    .describe("Prior revision id this revises; defaults to current active revision"),
  planning_style: z
    .enum(["spec", "tdd"])
    .optional()
    .describe("spec (default) or tdd after user confirmed via question tool"),
});

type PlanRevisionInput = z.infer<typeof PlanRevisionSchema>;

export const planRevisionTool: Tool<PlanRevisionInput> = Tool.define(
  "plan_revision",
  DESCRIPTION,
  PlanRevisionSchema,
  async (input: PlanRevisionInput): Promise<ToolResult> => {
    const sessionId = SessionManager.getCurrentSessionID();
    if (!sessionId) {
      return { success: false, output: "No active session. Start or resume a session first." };
    }

    const prior = getActivePlanRevision(sessionId);
    const style: PlanningStyle = input.planning_style ?? prior?.meta.planningStyle ?? "spec";

    const opts: { revises?: string; planningStyle: PlanningStyle } = {
      planningStyle: style,
    };
    const revisesTarget = input.revises ?? prior?.meta.revisionId;
    if (revisesTarget) {
      opts.revises = revisesTarget;
    }
    const revision = createPlanRevision(sessionId, opts);

    const session = SessionManager.getCurrentSession();
    if (session) {
      await SessionManager.update({
        metadata: {
          ...session.metadata,
          activePlanRevisionId: revision.meta.revisionId,
          planningStyle: revision.meta.planningStyle,
        },
      });
    }

    const paths = Object.entries(revision.files)
      .map(([name, p]) => `${name}: ${toRelativePlanPath(p)}`)
      .join("\n");

    return {
      success: true,
      output: [
        `Created plan revision: ${revision.meta.revisionId}`,
        `Revises: ${revision.meta.revises}`,
        `Planning style: ${revision.meta.planningStyle}`,
        "",
        "Active plan files:",
        paths,
        "",
        buildPlanModeContextBlock(sessionId),
      ].join("\n"),
    };
  }
);