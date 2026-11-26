/**
 * Input stage: turn file bytes of any supported kind into what the model reads (text or
 * images), plus hints and warnings.
 *
 * @packageDocumentation
 */
import { asImageMediaType, sniffImageType, type InputKind } from "./detect.js";
import { MenuExtractError } from "./errors.js";
import { extractPageTitle, htmlToText } from "./input/html.js";
import { prepareImage } from "./input/image.js";
import { parseMhtml } from "./input/mhtml.js";
import { extractDocxText, extractPptxText, stripRtf } from "./input/office.js";
import { extractPdfText, renderPdfPages } from "./input/pdf.js";
import type { LlmImage } from "./llm/types.js";
import type { ParseHints } from "./parse.js";

/** Content ready for the model. Exactly one of `text` or `images` is set. */
export interface PreparedInput {
  text?: string;
  images?: LlmImage[];
  hints: ParseHints;
  /** Problems met while reading the input, such as skipped PDF pages. */
  warnings: string[];
}

/** Limits that apply while preparing input. */
export interface PrepareLimits {
  minPdfTextChars: number;
  maxPdfPages: number;
  maxImageDimension: number;
  maxEmbeddedImages: number;
}

const textInput = (text: string, hints: ParseHints = {}): PreparedInput => ({
  text,
  hints,
  warnings: [],
});

const pageList = (indexes: number[]): string => indexes.map((i) => i + 1).join(", ");

async function prepareImageInput(buf: Buffer, limits: PrepareLimits): Promise<PreparedInput> {
  const image = await prepareImage(buf, limits.maxImageDimension);
  const mediaType = image.resized ? "image/jpeg" : (sniffImageType(image.buffer) ?? "image/jpeg");
  const warnings = image.processed
    ? []
    : ["image sent as-is: sharp is not installed or could not decode it (no rotation or resizing)"];
  return { images: [{ mediaType, base64: image.buffer.toString("base64") }], hints: {}, warnings };
}

async function preparePdfInput(buf: Buffer, limits: PrepareLimits): Promise<PreparedInput> {
  const { text, pageCount, failedPages } = await extractPdfText(buf);
  const warnings = failedPages.length
    ? [`PDF text could not be read on page(s) ${pageList(failedPages)}`]
    : [];
  if (text.length >= limits.minPdfTextChars) return { text, hints: {}, warnings };

  // Too little text layer: most likely a scan. Send page images instead.
  const render = await renderPdfPages(buf, limits.maxPdfPages);
  if (render.pages.length === 0) {
    if (text) return { text, hints: {}, warnings };
    throw new MenuExtractError(
      "UNREADABLE_INPUT",
      "The PDF has no readable text and no renderable pages",
    );
  }
  const renderWarnings = [
    ...(render.failedPages.length
      ? [`PDF page(s) ${pageList(render.failedPages)} could not be rendered`]
      : []),
    ...(pageCount > limits.maxPdfPages
      ? [`PDF has ${pageCount} pages; only the first ${limits.maxPdfPages} were sent`]
      : []),
  ];
  return {
    images: render.pages.map(({ mediaType, base64 }) => ({ mediaType, base64 })),
    hints: {},
    warnings: renderWarnings,
  };
}

function prepareMhtmlInput(buf: Buffer, limits: PrepareLimits): PreparedInput {
  const { html, images } = parseMhtml(buf);
  const text = htmlToText(html);
  if (text) return textInput(text, { restaurantName: extractPageTitle(html) ?? undefined });

  // A saved page whose menu is only pictures: send the embedded images.
  const usable = images.flatMap((img) => {
    const mediaType = asImageMediaType(img.mimeType);
    return mediaType ? [{ mediaType, base64: img.base64 }] : [];
  });
  if (usable.length === 0) {
    throw new MenuExtractError(
      "UNREADABLE_INPUT",
      "The MHTML file contains no text and no usable images",
    );
  }
  const warnings =
    usable.length > limits.maxEmbeddedImages
      ? [`MHTML has ${usable.length} images; only the first ${limits.maxEmbeddedImages} were sent`]
      : [];
  return { images: usable.slice(0, limits.maxEmbeddedImages), hints: {}, warnings };
}

/**
 * Read an input of a known kind.
 *
 * @throws {@link MenuExtractError} `UNREADABLE_INPUT` or `MISSING_DEPENDENCY`.
 */
export async function prepareInput(
  buf: Buffer,
  kind: InputKind,
  limits: PrepareLimits,
): Promise<PreparedInput> {
  switch (kind) {
    case "image":
      return prepareImageInput(buf, limits);
    case "pdf":
      return preparePdfInput(buf, limits);
    case "mhtml":
      return prepareMhtmlInput(buf, limits);
    case "html": {
      const html = buf.toString("utf8");
      return textInput(htmlToText(html), { restaurantName: extractPageTitle(html) ?? undefined });
    }
    case "docx":
      return textInput(await extractDocxText(buf));
    case "pptx":
      return textInput(await extractPptxText(buf));
    case "rtf":
      return textInput(stripRtf(buf.toString("utf8")));
    case "text":
      return textInput(buf.toString("utf8"));
  }
}
