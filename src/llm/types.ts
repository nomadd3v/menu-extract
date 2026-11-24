export interface LlmImage {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  /** base64 without a data: prefix */
  base64: string;
}

export interface LlmRequest {
  system: string;
  /** Plain-text menu content, if the input was textual. */
  text?: string;
  /** Page images, if the input was visual. */
  images?: LlmImage[];
  maxTokens: number;
}

export interface LlmResponse {
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/** The only thing the extractor knows about the model. Implement it to use any provider. */
export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResponse>;
}
