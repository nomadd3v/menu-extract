/**
 * MHTML ("Save page as… single file") parsing: split the MIME parts and decode the HTML
 * part and any embedded images.
 *
 * @packageDocumentation
 */

/** An image embedded in an MHTML file. */
export interface MhtmlImage {
  /** File name from `Content-Location`, or a generated one. */
  name: string;
  /** MIME type, e.g. `image/png`. */
  mimeType: string;
  /** Image bytes as base64 without a `data:` prefix. */
  base64: string;
}

/** The decoded contents of an MHTML file. */
export interface MhtmlDocument {
  /** The decoded HTML part (empty when there is none). */
  html: string;
  /** Embedded images, excluding tiny ones such as tracking pixels. */
  images: MhtmlImage[];
}

/** Base64 shorter than this (about 75 bytes) is treated as a spacer or tracking pixel. */
const MIN_IMAGE_BASE64_LENGTH = 100;

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Decode quoted-printable to bytes first, so multi-byte UTF-8 (`=E2=80=94`) survives. */
function decodeQuotedPrintable(input: string): string {
  const joined = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    const hex = joined.slice(i + 1, i + 3);
    if (joined[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(joined.charAt(i), "utf8"));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function decodeBody(body: string, encoding: string): string {
  if (encoding === "quoted-printable") return decodeQuotedPrintable(body);
  if (encoding === "base64") {
    return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  }
  return body;
}

function parseHeaders(block: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of block.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon > 0) {
      headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
    }
  }
  return headers;
}

/**
 * Parse an MHTML file into its HTML and embedded images. When no MIME boundary is found
 * the whole file is returned as HTML.
 *
 * @param buffer - MHTML bytes.
 * @returns The decoded HTML part and images.
 */
export function parseMhtml(buffer: Buffer): MhtmlDocument {
  const source = buffer.toString("utf8");
  const boundary = /boundary=["']?([^"'\r\n;]+)["']?/i.exec(source)?.[1]?.trim();
  if (!boundary) return { html: source, images: [] };

  const parts = source.split(new RegExp(`\\r?\\n--${escapeRegex(boundary)}`)).slice(1);
  let html = "";
  const images: MhtmlImage[] = [];

  parts.forEach((part, i) => {
    if (!part.trim() || part.trimStart().startsWith("--")) return; // closing boundary
    const crlf = part.indexOf("\r\n\r\n");
    const headerEnd = crlf !== -1 ? crlf : part.indexOf("\n\n");
    if (headerEnd === -1) return;

    const headers = parseHeaders(part.slice(0, headerEnd));
    const body = part.slice(headerEnd + (crlf !== -1 ? 4 : 2));
    const type = (headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    const encoding = (headers.get("content-transfer-encoding") ?? "").toLowerCase();

    if (type === "text/html") {
      html = decodeBody(body, encoding);
    } else if (type.startsWith("image/")) {
      const base64 =
        encoding === "base64" ? body.replace(/\s+/g, "") : Buffer.from(body).toString("base64");
      if (base64.length <= MIN_IMAGE_BASE64_LENGTH) return;
      const location = headers.get("content-location") ?? "";
      const name = location.split("/").pop()?.split("?")[0] || `image_${i + 1}`;
      images.push({ name, mimeType: type, base64 });
    }
  });

  return { html, images };
}
