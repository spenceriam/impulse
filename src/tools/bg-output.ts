import { z } from "zod";
import { Tool, type ToolResult } from "./registry";
import {
  getBgOutput,
  getBgJob,
  listBgJobs,
  killBgJob,
} from "./bg-process-registry.js";

const BgOutputSchema = z.object({
  id: z.string().describe("Background job ID returned by bash(background:true), e.g. 'bg-1'. Omit to list all jobs.").optional(),
});

Tool.define(
  "bg_output",
  "Read buffered output from a background job started with bash(background:true). Omit id to list all running jobs.",
  BgOutputSchema,
  async (input): Promise<ToolResult> => {
    if (!input.id) {
      const jobs = listBgJobs();
      if (jobs.length === 0) {
        return { success: true, output: "No background jobs." };
      }
      const lines = jobs.map((j) => {
        const end = j.endedAt ? ` — ended ${Math.round((Date.now() - j.endedAt) / 1000)}s ago` : "";
        return `${j.id} [${j.status}] pid=${j.pid ?? "?"}  ${j.command.slice(0, 60)}${end}`;
      });
      return { success: true, output: lines.join("\n") };
    }

    const job = getBgJob(input.id);
    if (!job) {
      return { success: false, output: `No background job '${input.id}'.` };
    }
    const out = getBgOutput(input.id) ?? "";
    const statusLine = job.status === "running" || job.status === "stopping"
      ? `[${input.id}] ${job.status} (pid ${job.pid ?? "?"}): ${job.command.slice(0, 60)}`
      : `[${input.id}] ${job.status} (exit ${job.exitCode ?? "?"}): ${job.command.slice(0, 60)}`;
    return {
      success: true,
      output: out ? `${statusLine}\n\n${out}` : `${statusLine}\n\n(no output yet)`,
      metadata: { bgJobId: input.id, status: job.status, exitCode: job.exitCode },
    };
  }
);

const BgKillSchema = z.object({
  id: z.string().describe("Background job ID to kill, e.g. 'bg-1'."),
});

Tool.define(
  "bg_kill",
  "Kill a running background job started with bash(background:true).",
  BgKillSchema,
  async (input): Promise<ToolResult> => {
    const job = getBgJob(input.id);
    if (!job) {
      return { success: false, output: `No background job '${input.id}'.` };
    }
    if (job.status !== "running" && job.status !== "stopping") {
      return { success: false, output: `Job '${input.id}' is already ${job.status}.` };
    }
    const ok = await killBgJob(input.id);
    return ok
      ? { success: true, output: `Job '${input.id}' killed.` }
      : { success: false, output: `Failed to kill job '${input.id}'.` };
  }
);
