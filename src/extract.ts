/**
 * The public extraction pipeline: input → text or images → LLM → validated menu.
 *
 * @packageDocumentation
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { detectKind, type InputKind } from "./detect.js";
import { MenuExtractError } from "./errors.js";
import type { LlmClient } from "./llm/types.js";
import type { ExtractionResult } from "./model.js";
import { parseModelResponse, type ParseHints } from "./parse.js";
import { prepareInput, type PreparedInput } from "./prepare.js";
import { SYSTEM_PROMPT } from "./prompt.js";

/** Options shared by every `extractFrom*` function. Only `client` is required. */
export interface ExtractOptions {
  /** The model to use: {@link AnthropicClient}, {@link MockLlmClient} or your own {@link LlmClient}. */
  client: LlmClient;
  /** Output token budget for the model. Default `16000`. */
  maxTokens?: number;
  /** Text longer than this is truncated (with a warning); there is no chunking. Default `40000`. */
  maxTextChars?: number;
  /** A PDF with less text than this is treated as scanned and sent as page images. Default `200`. */
  minPdfTextChars?: number;
  /** Most PDF pages rendered for a scanned PDF. Default `30`. */
  maxPdfPages?: number;
  /** Photos are downscaled to fit this many pixels on the longest side (needs `sharp`). Default `2048`. */
  maxImageDimension?: number;
  /** Most embedded images sent from an image-only MHTML page. Default `5`. */
  maxEmbeddedImages?: number;
  /** `fetch` used by {@link extractFromUrl}; inject one to test offline. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

const DEFAULTS = {
  maxTokens: 16_000,
  maxTextChars: 40_000,
  minPdfTextChars: 200,
  maxPdfPages: 30,
  maxImageDimension: 2048,
  maxEmbeddedImages: 5,
} as const;

const USER_AGENT = "menu-extract";

/** Send prepared input to the model and validate the reply. */
async function complete(input: PreparedInput, options: ExtractOptions): Promise<ExtractionResult> {
  const maxTextChars = options.maxTextChars ?? DEFAULTS.maxTextChars;
  const warnings = [...input.warnings];
  let text = input.text?.trim();
  if (text !== undefined) {
    if (!text) {
      throw new MenuExtractError("EMPTY_INPUT", "The input contains no text to extract from");
    }
    if (text.length > maxTextChars) {
      warnings.push(`input text truncated from ${text.length} to ${maxTextChars} characters`);
      text = text.slice(0, maxTextChars);
    }
  }

  const response = await options.client.complete({
    system: SYSTEM_PROMPT,
    ...(text !== undefined ? { text } : { images: input.images ?? [] }),
    maxTokens: options.maxTokens ?? DEFAULTS.maxTokens,
  });
  if (response.finishReason === "truncated") {
    throw new MenuExtractError(
      "LLM_TRUNCATED",
      "The model hit its output limit before finishing; raise maxTokens or split the menu",
    );
  }
  if (response.finishReason === "refused") {
    throw new MenuExtractError("LLM_REFUSED", "The model declined to process this input");
  }

  const result = parseModelResponse(response.text, input.hints);
  return { menu: result.menu, warnings: [...warnings, ...result.warnings] };
}

/**
 * Extract a menu from text you already have.
 *
 * @param text - Menu text.
 * @param options - See {@link ExtractOptions}.
 * @param hints - Fallbacks such as a restaurant name.
 * @throws {@link MenuExtractError} `EMPTY_INPUT` for blank text, or any LLM / parse error.
 */
export async function extractFromText(
  text: string,
  options: ExtractOptions,
  hints: ParseHints = {},
): Promise<ExtractionResult> {
  return complete({ text, hints, warnings: [] }, options);
}

/**
 * Extract a menu from file bytes. The format is detected from the bytes unless `kind` is given.
 *
 * @param buffer - File contents.
 * @param filename - Original file name, used as a format hint (e.g. `.pptx` vs `.docx`).
 * @param options - See {@link ExtractOptions}.
 * @param kind - Skip detection and treat the input as this format.
 * @throws {@link MenuExtractError} for unreadable input, a missing optional dependency, or
 *   any LLM / parse error.
 */
export async function extractFromBuffer(
  buffer: Buffer,
  filename: string,
  options: ExtractOptions,
  kind: InputKind = detectKind(buffer, filename),
): Promise<ExtractionResult> {
  const input = await prepareInput(buffer, kind, {
    minPdfTextChars: options.minPdfTextChars ?? DEFAULTS.minPdfTextChars,
    maxPdfPages: options.maxPdfPages ?? DEFAULTS.maxPdfPages,
    maxImageDimension: options.maxImageDimension ?? DEFAULTS.maxImageDimension,
    maxEmbeddedImages: options.maxEmbeddedImages ?? DEFAULTS.maxEmbeddedImages,
  });
  return complete(input, options);
}

/**
 * Extract a menu from a file on disk.
 *
 * @param path - Path to a PDF, image, HTML, MHTML, DOCX, PPTX, RTF or text file.
 * @param options - See {@link ExtractOptions}.
 * @throws {@link MenuExtractError}, or the file-system error if the file cannot be read.
 */
export async function extractFromFile(
  path: string,
  options: ExtractOptions,
): Promise<ExtractionResult> {
  return extractFromBuffer(await readFile(path), basename(path), options);
}

/**
 * Fetch a URL with one plain GET (no crawling, no JavaScript) and extract from the response.
 *
 * @param url - An `http:` or `https:` URL.
 * @param options - See {@link ExtractOptions}; set `fetch` to stay offline in tests.
 * @throws {@link MenuExtractError} `UNSUPPORTED_URL` for other schemes or malformed URLs,
 *   `FETCH_FAILED` for network errors and non-2xx responses, or any later pipeline error.
 */
export async function extractFromUrl(
  url: string,
  options: ExtractOptions,
): Promise<ExtractionResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (cause) {
    throw new MenuExtractError("UNSUPPORTED_URL", `Not a valid URL: ${url}`, { cause });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new MenuExtractError(
      "UNSUPPORTED_URL",
      `Only http(s) URLs are supported, got ${parsed.protocol}`,
    );
  }

  const fetchImpl = options.fetch ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(parsed, { headers: { "user-agent": USER_AGENT }, redirect: "follow" });
  } catch (cause) {
    throw new MenuExtractError("FETCH_FAILED", `Could not fetch ${parsed.href}`, { cause });
  }
  if (!res.ok) {
    throw new MenuExtractError(
      "FETCH_FAILED",
      `Fetch failed with HTTP ${res.status}: ${parsed.href}`,
    );
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const isHtml = (res.headers.get("content-type") ?? "").includes("html");
  const kind = detectKind(buffer, isHtml ? "page.html" : parsed.pathname);
  return extractFromBuffer(buffer, parsed.pathname, options, kind);
}
