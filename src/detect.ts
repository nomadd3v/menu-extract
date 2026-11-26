/**
 * Input-format detection from magic bytes, with the file name as a tie-breaker.
 *
 * @packageDocumentation
 */
import { extname } from "node:path";
import type { LlmImage } from "./llm/types.js";

/** Every input format the pipeline understands. */
export const INPUT_KINDS = [
  "pdf",
  "image",
  "html",
  "mhtml",
  "docx",
  "pptx",
  "rtf",
  "text",
] as const;
/** An input format the pipeline understands. */
export type InputKind = (typeof INPUT_KINDS)[number];

/** An image MIME type the LLM layer accepts. */
export type ImageMediaType = LlmImage["mediaType"];

const IMAGE_MEDIA_TYPES: readonly ImageMediaType[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

const ascii = (buf: Buffer, start: number, end: number): string =>
  buf.subarray(start, end).toString("latin1");

/**
 * Identify an image format from its signature.
 *
 * @param buf - File bytes.
 * @returns The media type, or `null` if the bytes are not JPEG, PNG, GIF or WebP.
 */
export function sniffImageType(buf: Buffer): ImageMediaType | null {
  if (buf[0] === 0x89 && ascii(buf, 1, 4) === "PNG") return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (ascii(buf, 0, 4) === "GIF8") return "image/gif";
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * Map a MIME type to an accepted image media type.
 *
 * @param mimeType - E.g. `image/png`.
 * @returns The media type, or `null` for formats the LLM layer does not accept (e.g. SVG).
 */
export function asImageMediaType(mimeType: string): ImageMediaType | null {
  return IMAGE_MEDIA_TYPES.find((t) => t === mimeType) ?? null;
}

/**
 * Decide the input format. Binary signatures win over the extension, so a PDF named
 * `menu.txt` is still read as a PDF; text formats fall back to the extension and then to
 * content sniffing.
 *
 * @param buf - File bytes.
 * @param filename - Original file name or URL path, used only as a hint.
 */
export function detectKind(buf: Buffer, filename = ""): InputKind {
  const ext = extname(filename).toLowerCase();
  if (ascii(buf, 0, 5) === "%PDF-") return "pdf";
  if (sniffImageType(buf)) return "image";
  if (ascii(buf, 0, 4) === "PK\u0003\u0004") return ext === ".pptx" ? "pptx" : "docx";
  if (ascii(buf, 0, 5) === "{\\rtf") return "rtf";

  const head = ascii(buf, 0, 1000);
  if (ext === ".mhtml" || ext === ".mht") return "mhtml";
  if (/^MIME-Version:/i.test(head) || /^From:.*\nSubject:/i.test(head)) return "mhtml";
  if (ext === ".html" || ext === ".htm") return "html";
  if (/<html|<!doctype html|<body/i.test(head)) return "html";
  return "text";
}
