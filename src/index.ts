/**
 * menu-extract: turn restaurant menus into a validated, vendor-neutral JSON model.
 *
 * @packageDocumentation
 */
export {
  extractFromBuffer,
  extractFromFile,
  extractFromText,
  extractFromUrl,
  type ExtractOptions,
} from "./extract.js";
export { detectKind, INPUT_KINDS, type InputKind } from "./detect.js";
export {
  parseKind,
  parseModelResponse,
  parsePrice,
  stripFences,
  type ParseHints,
} from "./parse.js";
export { CSV_COLUMNS, menuToCsv } from "./csv.js";
export { SYSTEM_PROMPT } from "./prompt.js";
export { MenuExtractError, type MenuExtractErrorCode } from "./errors.js";
export * from "./model.js";
export type { LlmClient, LlmFinishReason, LlmImage, LlmRequest, LlmResponse } from "./llm/types.js";
export { MockLlmClient, type MockResponder } from "./llm/mock.js";
export { AnthropicClient, DEFAULT_MODEL, type AnthropicClientOptions } from "./llm/anthropic.js";
