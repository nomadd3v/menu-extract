/**
 * Machine-readable reason for a {@link MenuExtractError}.
 *
 * - `EMPTY_INPUT`: the input contained no text to extract from.
 * - `UNREADABLE_INPUT`: the input could not be decoded (corrupt PDF, MHTML without content).
 * - `MISSING_DEPENDENCY`: an optional peer (`mupdf`) is needed for this input but not installed.
 * - `UNSUPPORTED_URL`: the URL is malformed or not http(s).
 * - `FETCH_FAILED`: the URL could not be fetched or returned a non-2xx status.
 * - `MISSING_API_KEY`: the LLM adapter has no API key.
 * - `LLM_REQUEST_FAILED`: the LLM provider returned an error.
 * - `LLM_TRUNCATED`: the model hit its output limit before finishing.
 * - `LLM_REFUSED`: the model declined the request.
 * - `INVALID_JSON`: the model's output is not JSON.
 * - `INVALID_RESPONSE`: the model's JSON has no recognisable menu structure.
 * - `INVALID_ARGUMENT`: a caller (usually the CLI) passed bad arguments.
 */
export type MenuExtractErrorCode =
  | "EMPTY_INPUT"
  | "UNREADABLE_INPUT"
  | "MISSING_DEPENDENCY"
  | "UNSUPPORTED_URL"
  | "FETCH_FAILED"
  | "MISSING_API_KEY"
  | "LLM_REQUEST_FAILED"
  | "LLM_TRUNCATED"
  | "LLM_REFUSED"
  | "INVALID_JSON"
  | "INVALID_RESPONSE"
  | "INVALID_ARGUMENT";

/**
 * The single error type thrown by this library.
 *
 * Branch on {@link MenuExtractError.code} rather than on the message, which is for humans
 * and may change. The underlying error, if any, is kept in `cause`.
 *
 * @example
 * ```ts
 * try {
 *   await extractFromFile("menu.pdf", { client });
 * } catch (err) {
 *   if (err instanceof MenuExtractError && err.code === "MISSING_DEPENDENCY") {
 *     console.error("Install the optional mupdf package to read PDFs.");
 *   } else throw err;
 * }
 * ```
 */
export class MenuExtractError extends Error {
  override readonly name = "MenuExtractError";

  /**
   * @param code - Machine-readable reason.
   * @param message - Human-readable description.
   * @param options - Standard error options; pass `cause` to keep the original error.
   */
  constructor(
    readonly code: MenuExtractErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
