import type { LlmClient, LlmRequest, LlmResponse } from "./types.js";

/** A canned reply, or a function computing one from the request. */
export type MockResponder = string | LlmResponse | ((request: LlmRequest) => string | LlmResponse);

/**
 * A deterministic {@link LlmClient} for tests, demos and replaying saved model output.
 * It never touches the network and records every request in {@link MockLlmClient.calls}.
 *
 * @example
 * ```ts
 * const client = new MockLlmClient('[{"name":"Soup","price":4}]');
 * const { menu } = await extractFromText("Soup 4.00", { client });
 * client.calls[0].text; // "Soup 4.00"
 * ```
 */
export class MockLlmClient implements LlmClient {
  /** Every request received, in order. */
  readonly calls: LlmRequest[] = [];

  /** @param respond - The reply text, a full {@link LlmResponse}, or a function returning either. */
  constructor(private readonly respond: MockResponder) {}

  /** Record the request and return the canned reply. */
  complete(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request);
    const reply = typeof this.respond === "function" ? this.respond(request) : this.respond;
    return Promise.resolve(
      typeof reply === "string" ? { text: reply, finishReason: "complete" } : reply,
    );
  }
}
