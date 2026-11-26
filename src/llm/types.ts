/**
 * The provider-neutral contract between the extractor and a language model.
 *
 * @packageDocumentation
 */

/** An image sent to the model. */
export interface LlmImage {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  /** Image bytes as base64 without a `data:` prefix. */
  base64: string;
}

/** One extraction request. Exactly one of `text` or `images` is set by the pipeline. */
export interface LlmRequest {
  /** System prompt describing the output format and rules. */
  system: string;
  /** Plain-text menu content, when the input was textual. */
  text?: string;
  /** Page or photo images, when the input was visual. */
  images?: LlmImage[];
  /** Output token budget. */
  maxTokens: number;
}

/**
 * Why the model stopped. `truncated` (hit the output limit) and `refused` are turned into
 * errors by the pipeline instead of being parsed as a menu.
 */
export type LlmFinishReason = "complete" | "truncated" | "refused";

/** The model's reply. */
export interface LlmResponse {
  /** Raw text output; expected to be JSON. */
  text: string;
  /** Why generation stopped. Omit when the provider does not say; it is treated as `complete`. */
  finishReason?: LlmFinishReason;
  /** Token usage, when the provider reports it. */
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * The only thing the extractor knows about a model. Implement this one method to use
 * any provider, a local model, or a cache.
 *
 * @example
 * ```ts
 * const client: LlmClient = {
 *   async complete(req) {
 *     const text = await myProvider.generate(req.system, req.text ?? "", req.images ?? []);
 *     return { text };
 *   },
 * };
 * ```
 */
export interface LlmClient {
  /**
   * Run one request.
   *
   * @throws Should throw a `MenuExtractError` with a `MISSING_API_KEY` or
   *   `LLM_REQUEST_FAILED` code; any other error is passed through unchanged.
   */
  complete(request: LlmRequest): Promise<LlmResponse>;
}
