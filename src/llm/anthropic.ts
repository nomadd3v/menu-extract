import type { LlmClient, LlmRequest, LlmResponse } from "./types.js";

export interface AnthropicOptions {
  /** Defaults to the ANTHROPIC_API_KEY environment variable. Never hard-code a key. */
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetch?: typeof fetch;
}

export const DEFAULT_MODEL = "claude-haiku-4-5";

/** Minimal Messages API adapter (plain fetch, no SDK). The key is read from the environment. */
export class AnthropicClient implements LlmClient {
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly explicitKey?: string;

  constructor(opts: AnthropicOptions = {}) {
    this.explicitKey = opts.apiKey;
    this.model = opts.model ?? process.env.MENU_EXTRACT_MODEL ?? DEFAULT_MODEL;
    this.baseUrl = (opts.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const apiKey = this.explicitKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

    const content: unknown[] = [];
    for (const img of req.images ?? []) {
      content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
    }
    content.push({
      type: "text",
      text: req.text
        ? `Extract the menu from the following content.\n\n${req.text}`
        : "Extract the menu shown in the attached image(s).",
    });

    const res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content }],
      }),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      throw new Error(`Anthropic API error ${res.status}: ${body}`);
    }
    const json = (await res.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens: number; output_tokens: number };
    };
    const text = (json.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    return {
      text,
      usage: json.usage ? { inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens } : undefined,
    };
  }
}
