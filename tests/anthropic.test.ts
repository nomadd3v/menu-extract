import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AnthropicClient, DEFAULT_MODEL } from "../src/index.js";
import { at, expectError } from "./helpers.js";

interface Seen {
  url: string;
  init: RequestInit;
}

/** A fetch that records requests and answers with a fixed status and JSON body. */
function fakeFetch(status: number, body: unknown): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const impl = (url: string | URL, init: RequestInit) => {
    seen.push({ url: String(url), init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { fetch: impl as typeof fetch, seen };
}

const reply = (text: string, stopReason = "end_turn") => ({
  content: [{ type: "text", text }],
  stop_reason: stopReason,
  usage: { input_tokens: 3, output_tokens: 1 },
});

const ENV_KEYS = ["ANTHROPIC_API_KEY", "MENU_EXTRACT_MODEL"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
beforeEach(() => {
  for (const k of ENV_KEYS) Reflect.deleteProperty(process.env, k);
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    const value = saved[k];
    if (value === undefined) Reflect.deleteProperty(process.env, k);
    else process.env[k] = value;
  }
});

describe("AnthropicClient (fake fetch, no network)", () => {
  it("fails fast without a key and makes no request", async () => {
    const { fetch, seen } = fakeFetch(200, {});
    const client = new AnthropicClient({ fetch });
    await expectError(
      () => client.complete({ system: "s", text: "t", maxTokens: 10 }),
      "MISSING_API_KEY",
    );
    expect(seen).toHaveLength(0);
  });

  it("builds a Messages API request with the key from the environment", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-from-env";
    const { fetch, seen } = fakeFetch(200, reply("[]"));
    const res = await new AnthropicClient({ fetch }).complete({
      system: "SYS",
      images: [{ mediaType: "image/png", base64: "AAAA" }],
      maxTokens: 123,
    });
    expect(res).toEqual({
      text: "[]",
      finishReason: "complete",
      usage: { inputTokens: 3, outputTokens: 1 },
    });

    const { url, init } = at(seen);
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers).toMatchObject({
      "x-api-key": "test-key-from-env",
      "anthropic-version": "2023-06-01",
    });
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ model: DEFAULT_MODEL, max_tokens: 123, system: "SYS" });
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
          { type: "text", text: "Extract the menu shown in the attached image(s)." },
        ],
      },
    ]);
  });

  it("prefers explicit options over the environment", async () => {
    process.env.ANTHROPIC_API_KEY = "env-key";
    process.env.MENU_EXTRACT_MODEL = "env-model";
    const { fetch, seen } = fakeFetch(200, reply("[]"));
    await new AnthropicClient({
      fetch,
      apiKey: "explicit",
      model: "explicit-model",
      baseUrl: "https://proxy.test/",
    }).complete({ system: "s", text: "Soup", maxTokens: 1 });
    const { url, init } = at(seen);
    expect(url).toBe("https://proxy.test/v1/messages");
    expect(init.headers).toMatchObject({ "x-api-key": "explicit" });
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "explicit-model" });
  });

  it("reads the model from MENU_EXTRACT_MODEL when none is given", async () => {
    process.env.MENU_EXTRACT_MODEL = "env-model";
    const { fetch, seen } = fakeFetch(200, reply("[]"));
    await new AnthropicClient({ fetch, apiKey: "k" }).complete({
      system: "s",
      text: "t",
      maxTokens: 1,
    });
    expect(JSON.parse(at(seen).init.body as string)).toMatchObject({ model: "env-model" });
  });

  it("maps stop reasons to provider-neutral finish reasons", async () => {
    const finish = async (stopReason: string) => {
      const { fetch } = fakeFetch(200, reply("[", stopReason));
      const res = await new AnthropicClient({ fetch, apiKey: "k" }).complete({
        system: "s",
        text: "t",
        maxTokens: 1,
      });
      return res.finishReason;
    };
    expect(await finish("max_tokens")).toBe("truncated");
    expect(await finish("refusal")).toBe("refused");
    expect(await finish("end_turn")).toBe("complete");
  });

  it("joins text blocks and ignores other block types", async () => {
    const { fetch } = fakeFetch(200, {
      content: [{ type: "thinking" }, { type: "text", text: "[" }, { type: "text", text: "]" }],
    });
    const res = await new AnthropicClient({ fetch, apiKey: "k" }).complete({
      system: "s",
      text: "t",
      maxTokens: 1,
    });
    expect(res).toEqual({ text: "[]", finishReason: "complete" });
  });

  it("surfaces API errors with the status code", async () => {
    const { fetch } = fakeFetch(429, { error: "rate limited" });
    const client = new AnthropicClient({ fetch, apiKey: "k" });
    const error = await expectError(
      () => client.complete({ system: "s", text: "t", maxTokens: 1 }),
      "LLM_REQUEST_FAILED",
    );
    expect(error.message).toMatch(/429/);
  });
});
