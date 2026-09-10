import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { OpenAIProvider } from "../../src/api/providers/openai.js";

/**
 * Wire-level check for the DeepSeek 400 in #145.
 *
 * Provider clients send `CompletionOptions.model` verbatim, so this asserts what
 * actually leaves the process. DeepSeek refuses the prefixed form:
 *
 *   400 The supported API model names are deepseek-flash, deepseek-v4-pro,
 *   but you passed deepseek/deepseek-flash.
 */

let server: Server;
let baseUrl = "";
const seenBodies: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        seenBodies.push(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        seenBodies.push({});
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "deepseek-flash",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("OpenAI-compatible provider forwards the model id verbatim", () => {
  test("sends the bare model id it is given", async () => {
    const provider = new OpenAIProvider({
      apiKey: "test-key",
      baseUrl,
      defaultModel: "deepseek/deepseek-flash",
    });
    seenBodies.length = 0;

    await provider.complete({
      model: "deepseek-flash",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 5,
    });

    expect(seenBodies).toHaveLength(1);
    expect(seenBodies[0]!.model).toBe("deepseek-flash");
  });

  test("forwards a prefixed id unchanged — callers must resolve it first", async () => {
    const provider = new OpenAIProvider({
      apiKey: "test-key",
      baseUrl,
      defaultModel: "deepseek/deepseek-flash",
    });
    seenBodies.length = 0;

    await provider.complete({
      model: "deepseek/deepseek-flash",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 5,
    });

    // This is the defect: the provider does not strip the prefix itself, which
    // is why every call site must pass an already-resolved bare model id.
    expect(seenBodies[0]!.model).toBe("deepseek/deepseek-flash");
  });

  test("falls back to the configured default model when none is passed", async () => {
    const provider = new OpenAIProvider({
      apiKey: "test-key",
      baseUrl,
      defaultModel: "deepseek/deepseek-flash",
    });
    seenBodies.length = 0;

    await provider.complete({
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 5,
    });

    // Title generation used to rely on this fallback, which is how a prefixed
    // default model leaked upstream even though no model was passed.
    expect(seenBodies[0]!.model).toBe("deepseek/deepseek-flash");
  });
});
