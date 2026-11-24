import type { LlmClient, LlmRequest, LlmResponse } from "./types.js";

/** Deterministic client for tests and offline demos. Records every request it receives. */
export class MockLlmClient implements LlmClient {
  readonly calls: LlmRequest[] = [];
  constructor(private readonly respond: string | ((req: LlmRequest) => string)) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    const text = typeof this.respond === "function" ? this.respond(req) : this.respond;
    return { text, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
