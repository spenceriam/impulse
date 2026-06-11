import { describe, expect, test } from "bun:test";
import {
  accumulateToolCallDelta,
  type PartialToolCall,
} from "../../src/agent/tool-call-accumulator.js";

function freshMap(): Map<number, PartialToolCall> {
  return new Map();
}

const idFor = (idx: number) => `call_${idx}`;

describe("accumulateToolCallDelta", () => {
  test("single tool call on index 0", () => {
    const map = freshMap();
    accumulateToolCallDelta(
      map,
      { index: 0, id: "a", function: { name: "set_header", arguments: '{"title":"x"}' } },
      idFor,
    );
    expect(map.size).toBe(1);
    expect(map.get(0)?.name).toBe("set_header");
  });

  test("parallel tools with duplicate index 0 split into separate slots", () => {
    const map = freshMap();
    accumulateToolCallDelta(
      map,
      { index: 0, function: { name: "todo_write", arguments: '{"todos":[]}' } },
      idFor,
    );
    accumulateToolCallDelta(
      map,
      { index: 0, function: { name: "bash", arguments: '{"command":"ls"}' } },
      idFor,
    );
    accumulateToolCallDelta(
      map,
      { index: 0, function: { name: "set_header", arguments: '{"title":"t"}' } },
      idFor,
    );
    expect(map.size).toBe(3);
    expect(map.get(0)?.name).toBe("todo_write");
    expect(map.get(1)?.name).toBe("bash");
    expect(map.get(2)?.name).toBe("set_header");
  });

  test("does not merge set_header and question into set_headerquestion", () => {
    const map = freshMap();
    accumulateToolCallDelta(
      map,
      { index: 0, function: { name: "set_header", arguments: '{"title":"t"}' } },
      idFor,
    );
    accumulateToolCallDelta(
      map,
      { index: 0, function: { name: "question", arguments: '{"questions":[]}' } },
      idFor,
    );
    expect(map.get(0)?.name).toBe("set_header");
    expect(map.get(1)?.name).toBe("question");
  });

  test("streams name prefix on same index", () => {
    const map = freshMap();
    accumulateToolCallDelta(map, { index: 0, function: { name: "set_" } }, idFor);
    accumulateToolCallDelta(map, { index: 0, function: { name: "set_header" } }, idFor);
    expect(map.size).toBe(1);
    expect(map.get(0)?.name).toBe("set_header");
  });

  test("appends argument fragments on same index", () => {
    const map = freshMap();
    accumulateToolCallDelta(map, { index: 0, function: { name: "bash", arguments: '{"cmd":' } }, idFor);
    accumulateToolCallDelta(map, { index: 0, function: { arguments: '"ls"}' } }, idFor);
    expect(map.get(0)?.argumentsJson).toBe('{"cmd":"ls"}');
  });

  test("parallel file_read on duplicate index 0 does not merge args", () => {
    const map = freshMap();
    accumulateToolCallDelta(
      map,
      {
        index: 0,
        id: "call_a",
        function: { name: "file_read", arguments: '{"filePath":"a.md"}' },
      },
      idFor
    );
    accumulateToolCallDelta(
      map,
      {
        index: 0,
        id: "call_b",
        function: { name: "file_read", arguments: '{"filePath":"b.md"}' },
      },
      idFor
    );
    expect(map.size).toBe(2);
    expect(map.get(0)?.argumentsJson).toBe('{"filePath":"a.md"}');
    expect(map.get(1)?.argumentsJson).toBe('{"filePath":"b.md"}');
  });
});
