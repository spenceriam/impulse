import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  appendTraceRecord,
  readTraceRecords,
  TRACE_SCHEMA_VERSION,
  traceFilePath,
  type TraceRecord,
} from "../src/harness/trace.js";

let tmpHome: string;
let prevHome: string | undefined;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-trace-test-"));
  prevHome = process.env["IMPULSE_HOME"];
  process.env["IMPULSE_HOME"] = tmpHome;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env["IMPULSE_HOME"];
  else process.env["IMPULSE_HOME"] = prevHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function record(turn: number, outcome: TraceRecord["outcome"] = "success"): TraceRecord {
  return {
    schema: TRACE_SCHEMA_VERSION,
    turn,
    timestamp: new Date().toISOString(),
    mode: "WORK",
    model: "test-model",
    input: { messageCount: 4, promptTokens: 1200, cachedTokens: 900 },
    steps: {
      tools: [{ name: "file_read", outcome: "success", outputChars: 320 }],
      permissions: [{ tool: "bash", decision: "allowed" }],
    },
    outcome,
  };
}

describe("trace records", () => {
  test("records round-trip in order", async () => {
    await appendTraceRecord("sess_test1", record(1));
    await appendTraceRecord("sess_test1", record(2, "failed"));
    const records = await readTraceRecords("sess_test1");
    expect(records.map((r) => r.turn)).toEqual([1, 2]);
    expect(records[1]!.outcome).toBe("failed");
  });

  test("a torn line is skipped, not fatal", async () => {
    await appendTraceRecord("sess_test2", record(1));
    fs.appendFileSync(traceFilePath("sess_test2"), '{"schema":1,"turn":2,"timestamp"');
    const records = await readTraceRecords("sess_test2");
    expect(records).toHaveLength(1);
  });

  test("unknown session reads as empty", async () => {
    expect(await readTraceRecords("sess_missing")).toEqual([]);
  });
});
