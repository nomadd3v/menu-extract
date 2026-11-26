import { describe, expect, it } from "vitest";
import {
  AnthropicClient,
  extractFromBuffer,
  extractFromText,
  extractFromUrl,
  MenuExtractError,
  MockLlmClient,
  parseModelResponse,
  type MenuExtractErrorCode,
} from "../src/index.js";
import { expectError } from "./helpers.js";

const client = new MockLlmClient("[]");
const noNetwork = (() => Promise.reject(new TypeError("offline"))) as typeof fetch;

describe("MenuExtractError", () => {
  it("is a real Error with a name, a code and an optional cause", () => {
    const cause = new Error("root");
    const error = new MenuExtractError("FETCH_FAILED", "Could not fetch", { cause });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("MenuExtractError");
    expect(error.code).toBe("FETCH_FAILED");
    expect(error.message).toBe("Could not fetch");
    expect(error.cause).toBe(cause);
    expect(String(error)).toBe("MenuExtractError: Could not fetch");
  });

  // One public-API trigger per code. MISSING_DEPENDENCY is covered in pdf.test.ts (it needs
  // module mocking) and INVALID_ARGUMENT in cli.test.ts.
  const triggers: [MenuExtractErrorCode, () => Promise<unknown>][] = [
    ["EMPTY_INPUT", () => extractFromText(" ", { client })],
    [
      "UNREADABLE_INPUT",
      () => extractFromBuffer(Buffer.from("PK\u0003\u0004 broken"), "m.docx", { client }),
    ],
    ["UNSUPPORTED_URL", () => extractFromUrl("ftp://example.com/menu", { client })],
    [
      "FETCH_FAILED",
      () => extractFromUrl("https://example.com/menu", { client, fetch: noNetwork }),
    ],
    [
      "MISSING_API_KEY",
      () =>
        new AnthropicClient({ apiKey: "", fetch: noNetwork }).complete({
          system: "",
          maxTokens: 1,
        }),
    ],
    [
      "LLM_REQUEST_FAILED",
      () =>
        new AnthropicClient({ apiKey: "k", fetch: noNetwork }).complete({
          system: "",
          maxTokens: 1,
        }),
    ],
    [
      "LLM_TRUNCATED",
      () =>
        extractFromText("Soup", {
          client: new MockLlmClient({ text: "[", finishReason: "truncated" }),
        }),
    ],
    [
      "LLM_REFUSED",
      () =>
        extractFromText("Soup", {
          client: new MockLlmClient({ text: "", finishReason: "refused" }),
        }),
    ],
    ["INVALID_JSON", () => Promise.resolve().then(() => parseModelResponse("{"))],
    ["INVALID_RESPONSE", () => Promise.resolve().then(() => parseModelResponse("{}"))],
  ];

  it.each(triggers)("%s is raised by the public API", async (code, trigger) => {
    await expectError(trigger, code);
  });
});
