import { MenuExtractError } from "../errors.js";
import type { LlmClient, LlmFinishReason, LlmRequest, LlmResponse } from "./types.js";

/** Options for {@link AnthropicClient}. */
export interface AnthropicClientOptions {
  /** API key. Defaults to the `ANTHROPIC_API_KEY` environment variable; never hard-code one. */
  apiKey?: string;
  /** Model id. Defaults to `MENU_EXTRACT_MODEL` from the environment, then {@link DEFAULT_MODEL}. */
  model?: string;
  /** API origin. Defaults to `https://api.anthropic.com`. */
  baseUrl?: string;
  /** `fetch` implementation; inject one to test offline. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/** Model used when none is configured. */
export const DEFAULT_MODEL = "claude-haiku-4-5";

const API_VERSION = "2023-06-01";
/** Longest slice of an error body included in an error message. */
const MAX_ERROR_BODY = 300;

/** The subset of a Messages API response this adapter reads. */
interface MessagesResponse {
  content?: { type: string; text?: string }[];
  stop_reason?: string | null;
  usage?: { input_tokens: number; output_tokens: number };
}

const FINISH_REASONS: Record<string, LlmFinishReason> = {
  max_tokens: "truncated",
  refusal: "refused",
};

/**
 * {@link LlmClient} for the Anthropic Messages API, written against plain `fetch` so the
 * library has no SDK dependency. The key is read when a request is made, not at construction.
 *
 * @example
 * ```ts
 * const client = new AnthropicClient(); // ANTHROPIC_API_KEY from the environment
 * const { menu } = await extractFromFile("menu.pdf", { client });
 * ```
 */
export class AnthropicClient implements LlmClient {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  /** @param options - See {@link AnthropicClientOptions}. */
  constructor(options: AnthropicClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? process.env.MENU_EXTRACT_MODEL ?? DEFAULT_MODEL;
    this.baseUrl = (options.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  /**
   * Send one Messages API request.
   *
   * @throws {@link MenuExtractError} `MISSING_API_KEY` when no key is available, or
   *   `LLM_REQUEST_FAILED` on a network error or non-2xx response.
   */
  async complete(request: LlmRequest): Promise<LlmResponse> {
    const apiKey = this.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new MenuExtractError("MISSING_API_KEY", "ANTHROPIC_API_KEY is not set");

    const content = [
      ...(request.images ?? []).map((img) => ({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.base64 },
      })),
      {
        type: "text",
        text: request.text
          ? `Extract the menu from the following content.\n\n${request.text}`
          : "Extract the menu shown in the attached image(s).",
      },
    ];

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: [{ role: "user", content }],
        }),
      });
    } catch (cause) {
      throw new MenuExtractError("LLM_REQUEST_FAILED", "Could not reach the Anthropic API", {
        cause,
      });
    }
    if (!res.ok) {
      const body = (await res.text()).slice(0, MAX_ERROR_BODY);
      throw new MenuExtractError(
        "LLM_REQUEST_FAILED",
        `Anthropic API error ${res.status}: ${body}`,
      );
    }

    const json = (await res.json()) as MessagesResponse;
    const text = (json.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    return {
      text,
      finishReason: FINISH_REASONS[json.stop_reason ?? ""] ?? "complete",
      ...(json.usage && {
        usage: { inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens },
      }),
    };
  }
}
