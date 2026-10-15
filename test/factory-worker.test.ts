import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseWorkerArgs, validateJob } from "../src/worker.js";

describe("factory worker arguments", () => {
  test("accepts the protocol probe", () => {
    expect(parseWorkerArgs(["--factory-protocol"]).probe).toBe(true);
    expect(parseWorkerArgs(["--factory-protocol", "impulse-factory-worker/v1"]).probe).toBe(true);
  });

  test("rejects an unsupported protocol value", () => {
    expect(() => parseWorkerArgs(["--factory-protocol", "other/v1"])).toThrow(/Unsupported factory protocol/);
  });

  test("requires values for job and prompt paths", () => {
    expect(() => parseWorkerArgs(["--job"])).toThrow(/--job requires/);
    expect(() => parseWorkerArgs(["--prompt"])).toThrow(/--prompt requires/);
  });

  test("rejects invalid timeout values", () => {
    expect(() => parseWorkerArgs(["--timeout-ms", "abc"])).toThrow(/positive number/);
  });
});

describe("factory worker job validation", () => {
  test("requires paths to stay inside the assigned stage directory", () => {
    const root = mkdtempSync(path.join(tmpdir(), "impulse-worker-job-"));
    try {
      const workdir = path.join(root, "work");
      const stageDir = path.join(root, "run", "stages", "triage");
      mkdirSync(workdir, { recursive: true });
      mkdirSync(stageDir, { recursive: true });
      const job = {
        protocolVersion: "impulse-factory-result/v1",
        workerProtocol: "impulse-factory-worker/v1",
        runId: "run-1",
        stage: "triage",
        resultPath: path.join(stageDir, "triage-result.json"),
        artifacts: {
          runDir: path.join(root, "run"),
          stageDir,
          resultPath: path.join(stageDir, "triage-result.json"),
        },
        repository: { workdir },
      };
      expect(validateJob(job).stage).toBe("triage");

      const escaping = {
        ...job,
        resultPath: path.join(root, "outside.json"),
        artifacts: { ...job.artifacts, resultPath: path.join(root, "outside.json") },
      };
      expect(() => validateJob(escaping)).toThrow(/inside job.artifacts.stageDir/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("factory worker process", () => {
  test("answers the protocol probe without importing the interactive renderer", async () => {
    const process = Bun.spawn(["bun", "src/worker.ts", "--factory-protocol"], {
      cwd: path.resolve(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(process.stdout).text();
    const exitCode = await process.exited;
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("impulse-factory-worker/v1");
  });

});
