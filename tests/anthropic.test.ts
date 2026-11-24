import { describe, it, expect, afterEach } from "vitest";
import { AnthropicClient, DEFAULT_MODEL } from "../src/llm/anthropic.js";

const saved = process.env.ANTHROPIC_API_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = saved;
});

function fakeFetch(status: number, body: unknown) {
  const seen: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string | URL, init: RequestInit) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { f, seen };
}

describe("AnthropicClient (fake fetch, no network)", () => {
  it("fails fast without a key in the environment", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { f, seen } = fakeFetch(200, {});
    await expect(new AnthropicClient({ fetch: f }).complete({ system: "s", text: "t", maxTokens: 10 })).rejects.toThrow(/ANTHROPIC_API_KEY/);
    expect(seen).toHaveLength(0);
  });

  it("builds a Messages API request with the key from the environment", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-from-env";
    const { f, seen } = fakeFetch(200, {
      content: [{ type: "text", text: "[]" }],
      usage: { input_tokens: 3, output_tokens: 1 },
    });
    const res = await new AnthropicClient({ fetch: f }).complete({
      system: "SYS",
      images: [{ mediaType: "image/png", base64: "AAAA" }],
      maxTokens: 123,
    });
    expect(res).toEqual({ text: "[]", usage: { inputTokens: 3, outputTokens: 1 } });
    expect(seen[0].url).toBe("https://api.anthropic.com/v1/messages");
    const headers = seen[0].init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key-from-env");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(seen[0].init.body as string);
    expect(body.model).toBe(DEFAULT_MODEL);
    expect(body.max_tokens).toBe(123);
    expect(body.system).toBe("SYS");
    expect(body.messages[0].content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } });
  });

  it("surfaces API errors", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    const { f } = fakeFetch(429, { error: "rate" });
    await expect(new AnthropicClient({ fetch: f }).complete({ system: "s", text: "t", maxTokens: 1 })).rejects.toThrow(/429/);
  });
});
