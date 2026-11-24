import { basename, extname } from "node:path";
import { readFile } from "node:fs/promises";
import type { ExtractionResult } from "./model.js";
import { parseModelResponse } from "./parse.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import type { LlmClient, LlmImage } from "./llm/types.js";
import { extractPageTitle, htmlToText } from "./input/html.js";
import { parseMhtml } from "./input/mhtml.js";
import { extractDocxText, extractPptxText, stripRtf } from "./input/office.js";
import { extractPdfText, renderPdfPages } from "./input/pdf.js";
import { normalizeRotation, resizeImage } from "./input/image.js";

export type InputKind = "pdf" | "image" | "html" | "mhtml" | "docx" | "pptx" | "rtf" | "text";

export interface ExtractOptions {
  client: LlmClient;
  /** Output budget for the model. Default 16000. */
  maxTokens?: number;
  /** A PDF with fewer extractable characters than this is treated as scanned and sent as page images. Default 200. */
  minPdfTextChars?: number;
}

const IMAGE_MIME: Record<string, LlmImage["mediaType"]> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp",
};

/** Decide the input kind from magic bytes first, then the file extension. */
export function detectKind(buf: Buffer, filename = ""): InputKind {
  const ext = extname(filename).toLowerCase();
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString("latin1") === "PNG") return "image";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image";
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return "image";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image";
  if (buf.subarray(0, 4).toString("latin1") === "PK\u0003\u0004") {
    if (ext === ".pptx") return "pptx";
    return "docx";
  }
  if (buf.subarray(0, 5).toString("latin1") === "{\\rtf") return "rtf";
  if (ext === ".mhtml" || ext === ".mht") return "mhtml";
  if (/^MIME-Version:/i.test(buf.subarray(0, 200).toString("latin1")) || /^From:.*\nSubject:/i.test(buf.subarray(0, 200).toString("latin1"))) return "mhtml";
  if (ext === ".html" || ext === ".htm") return "html";
  const head = buf.subarray(0, 1000).toString("utf8").toLowerCase();
  if (head.includes("<html") || head.includes("<!doctype html") || head.includes("<body")) return "html";
  return "text";
}

function sniffImageMime(buf: Buffer, filename: string): LlmImage["mediaType"] {
  if (buf[0] === 0x89) return "image/png";
  if (buf[0] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF") return "image/webp";
  return IMAGE_MIME[extname(filename).toLowerCase()] ?? "image/jpeg";
}

async function run(
  opts: ExtractOptions,
  content: { text?: string; images?: LlmImage[] },
  hints: { restaurantName?: string },
): Promise<ExtractionResult> {
  const res = await opts.client.complete({
    system: SYSTEM_PROMPT,
    text: content.text,
    images: content.images,
    maxTokens: opts.maxTokens ?? 16000,
  });
  return parseModelResponse(res.text, hints);
}

/** Extract a menu from plain text that has already been obtained. */
export function extractFromText(text: string, opts: ExtractOptions, hints: { restaurantName?: string } = {}) {
  if (!text.trim()) throw new Error("No text content to extract from");
  return run(opts, { text }, hints);
}

/** Extract a menu from file bytes. The kind is auto-detected unless given. */
export async function extractFromBuffer(
  buf: Buffer,
  filename: string,
  opts: ExtractOptions,
  kind: InputKind = detectKind(buf, filename),
): Promise<ExtractionResult> {
  switch (kind) {
    case "image": {
      const rotated = await normalizeRotation(buf);
      const { buffer, resized } = await resizeImage(rotated);
      const mediaType = resized ? "image/jpeg" : sniffImageMime(rotated, filename);
      return run(opts, { images: [{ mediaType, base64: buffer.toString("base64") }] }, {});
    }
    case "pdf": {
      const text = await extractPdfText(buf);
      if (text.trim().length >= (opts.minPdfTextChars ?? 200)) return run(opts, { text }, {});
      const pages = await renderPdfPages(buf);
      if (pages.length === 0) {
        if (text.trim()) return run(opts, { text }, {});
        throw new Error('Could not read the PDF (scanned PDFs need the optional "mupdf" package)');
      }
      return run(opts, { images: pages.map((p) => ({ mediaType: p.mimeType, base64: p.base64 })) }, {});
    }
    case "mhtml": {
      const { html, images } = parseMhtml(buf);
      const text = htmlToText(html);
      if (text) return run(opts, { text }, { restaurantName: extractPageTitle(html) ?? undefined });
      const imgs = images
        .filter((i) => i.mimeType in { "image/jpeg": 1, "image/png": 1, "image/gif": 1, "image/webp": 1 })
        .slice(0, 5)
        .map((i) => ({ mediaType: i.mimeType as LlmImage["mediaType"], base64: i.base64 }));
      if (imgs.length === 0) throw new Error("MHTML contained no text or usable images");
      return run(opts, { images: imgs }, {});
    }
    case "html": {
      const html = buf.toString("utf8");
      return extractFromText(htmlToText(html), opts, { restaurantName: extractPageTitle(html) ?? undefined });
    }
    case "docx":
      return extractFromText(await extractDocxText(buf), opts);
    case "pptx":
      return extractFromText(await extractPptxText(buf), opts);
    case "rtf":
      return extractFromText(stripRtf(buf.toString("utf8")), opts);
    default:
      return extractFromText(buf.toString("utf8"), opts);
  }
}

export async function extractFromFile(path: string, opts: ExtractOptions) {
  return extractFromBuffer(await readFile(path), basename(path), opts);
}

/** Fetch a URL and extract from the page text. `fetchImpl` is injectable so tests stay offline. */
export async function extractFromUrl(url: string, opts: ExtractOptions, fetchImpl: typeof fetch = fetch) {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http(s) URLs are supported");
  const res = await fetchImpl(u, { headers: { "user-agent": "menu-extract/0.1" }, redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") ?? "";
  const kind = detectKind(buf, ct.includes("html") ? "page.html" : u.pathname);
  return extractFromBuffer(buf, u.pathname, opts, kind);
}
